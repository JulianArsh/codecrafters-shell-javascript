const readline = require("readline");
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

function findExecutableInPath(command) {
  // Get the PATH environment variable
  const pathEnv = process.env.PATH || "";
  
  // Split by the OS-specific path delimiter
  const directories = pathEnv.split(path.delimiter);
  
  // Search through each directory
  for (const dir of directories) {
    const fullPath = path.join(dir, command);
    
    try {
      // Check if file exists and has execute permissions
      if (fs.existsSync(fullPath)) {
        // Check execute permission using fs.accessSync with fs.constants.X_OK
        try {
          fs.accessSync(fullPath, fs.constants.X_OK);
          return fullPath;
        } catch (err) {
          // File exists but no execute permission, continue to next directory
          continue;
        }
      }
    } catch (err) {
      // Directory doesn't exist or other error, continue
      continue;
    }
  }
  
  return null;
}

function parseCommandLine(commandLine) {
  const args = [];
  let currentArg = "";
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let redirectOutput = null;
  let redirectError = null;
  let appendOutput = null;
  let appendError = null;
  let i = 0;
  
  while (i < commandLine.length) {
    const char = commandLine[i];
    
    if (char === '\\' && !inSingleQuote && inDoubleQuote) {
      // Backslash inside double quotes - only escape special characters
      i++; // Move past the backslash
      if (i < commandLine.length) {
        const nextChar = commandLine[i];
        // In double quotes, backslash escapes: dollar sign, backtick, double quote, backslash
        if (nextChar === '"' || nextChar === '\\' || nextChar === '$' || nextChar === '`') {
          // These characters are escaped - remove backslash, add the character
          currentArg += nextChar;
          i++;
        } else {
          // Other characters - keep the backslash literal
          currentArg += '\\' + nextChar;
          i++;
        }
      }
    } else if (char === '\\' && !inSingleQuote && !inDoubleQuote) {
      // Backslash outside quotes - escape any character
      i++; // Move past the backslash
      if (i < commandLine.length) {
        // Add the next character literally (the backslash is removed)
        currentArg += commandLine[i];
        i++;
      }
    } else if (char === "'" && !inDoubleQuote) {
      // Single quote (toggle single quote mode, unless in double quotes)
      inSingleQuote = !inSingleQuote;
      i++;
    } else if (char === '"' && !inSingleQuote) {
      // Double quote (toggle double quote mode, unless in single quotes)
      inDoubleQuote = !inDoubleQuote;
      i++;
    } else if (char === '>' && !inSingleQuote && !inDoubleQuote) {
      // Check if it's >> (append) or just > (overwrite)
      if (i + 1 < commandLine.length && commandLine[i + 1] === '>') {
        // >> append operator
        if (currentArg.length > 0) {
          args.push(currentArg);
          currentArg = "";
        }
        
        i += 2; // Move past '>>'
        
        // Skip whitespace after '>>'
        while (i < commandLine.length && (commandLine[i] === ' ' || commandLine[i] === '\t')) {
          i++;
        }
        
        // Parse the output filename
        let filename = "";
        let inFileQuote = false;
        let fileQuoteChar = null;
        
        while (i < commandLine.length) {
          const c = commandLine[i];
          
          if ((c === '"' || c === "'") && !inFileQuote) {
            inFileQuote = true;
            fileQuoteChar = c;
            i++;
          } else if (c === fileQuoteChar && inFileQuote) {
            inFileQuote = false;
            fileQuoteChar = null;
            i++;
          } else if ((c === ' ' || c === '\t') && !inFileQuote) {
            break;
          } else {
            filename += c;
            i++;
          }
        }
        
        appendOutput = filename;
      } else {
        // Single > redirection operator
        if (currentArg.length > 0) {
          args.push(currentArg);
          currentArg = "";
        }
        
        i++; // Move past '>'
        
        // Skip whitespace after '>'
        while (i < commandLine.length && (commandLine[i] === ' ' || commandLine[i] === '\t')) {
          i++;
        }
        
        // Parse the output filename
        let filename = "";
        let inFileQuote = false;
        let fileQuoteChar = null;
        
        while (i < commandLine.length) {
          const c = commandLine[i];
          
          if ((c === '"' || c === "'") && !inFileQuote) {
            inFileQuote = true;
            fileQuoteChar = c;
            i++;
          } else if (c === fileQuoteChar && inFileQuote) {
            inFileQuote = false;
            fileQuoteChar = null;
            i++;
          } else if ((c === ' ' || c === '\t') && !inFileQuote) {
            break;
          } else {
            filename += c;
            i++;
          }
        }
        
        redirectOutput = filename;
      }
    } else if (char === '2' && !inSingleQuote && !inDoubleQuote && i + 1 < commandLine.length && commandLine[i + 1] === '>') {
      // Handle 2> redirection (stderr)
      if (currentArg.length > 0) {
        args.push(currentArg);
        currentArg = "";
      }
      
      i += 2; // Move past '2>'
      
      // Skip whitespace after '2>'
      while (i < commandLine.length && (commandLine[i] === ' ' || commandLine[i] === '\t')) {
        i++;
      }
      
      // Parse the output filename
      let filename = "";
      let inFileQuote = false;
      let fileQuoteChar = null;
      
      while (i < commandLine.length) {
        const c = commandLine[i];
        
        if ((c === '"' || c === "'") && !inFileQuote) {
          inFileQuote = true;
          fileQuoteChar = c;
          i++;
        } else if (c === fileQuoteChar && inFileQuote) {
          inFileQuote = false;
          fileQuoteChar = null;
          i++;
        } else if ((c === ' ' || c === '\t') && !inFileQuote) {
          break;
        } else {
          filename += c;
          i++;
        }
      }
      
      redirectError = filename;
    } else if (char === '1' && !inSingleQuote && !inDoubleQuote && i + 1 < commandLine.length && commandLine[i + 1] === '>') {
      // Check if it's 1>> (append) or 1> (overwrite)
      if (i + 2 < commandLine.length && commandLine[i + 2] === '>') {
        // 1>> append operator
        if (currentArg.length > 0) {
          args.push(currentArg);
          currentArg = "";
        }
        
        i += 3; // Move past '1>>'
        
        // Skip whitespace after '1>>'
        while (i < commandLine.length && (commandLine[i] === ' ' || commandLine[i] === '\t')) {
          i++;
        }
        
        // Parse the output filename
        let filename = "";
        let inFileQuote = false;
        let fileQuoteChar = null;
        
        while (i < commandLine.length) {
          const c = commandLine[i];
          
          if ((c === '"' || c === "'") && !inFileQuote) {
            inFileQuote = true;
            fileQuoteChar = c;
            i++;
          } else if (c === fileQuoteChar && inFileQuote) {
            inFileQuote = false;
            fileQuoteChar = null;
            i++;
          } else if ((c === ' ' || c === '\t') && !inFileQuote) {
            break;
          } else {
            filename += c;
            i++;
          }
        }
        
        appendOutput = filename;
      } else {
        // 1> redirection (same as >)
        if (currentArg.length > 0) {
          args.push(currentArg);
          currentArg = "";
        }
        
        i += 2; // Move past '1>'
        
        // Skip whitespace after '1>'
        while (i < commandLine.length && (commandLine[i] === ' ' || commandLine[i] === '\t')) {
          i++;
        }
        
        // Parse the output filename
        let filename = "";
        let inFileQuote = false;
        let fileQuoteChar = null;
        
        while (i < commandLine.length) {
          const c = commandLine[i];
          
          if ((c === '"' || c === "'") && !inFileQuote) {
            inFileQuote = true;
            fileQuoteChar = c;
            i++;
          } else if (c === fileQuoteChar && inFileQuote) {
            inFileQuote = false;
            fileQuoteChar = null;
            i++;
          } else if ((c === ' ' || c === '\t') && !inFileQuote) {
            break;
          } else {
            filename += c;
            i++;
          }
        }
        
        redirectOutput = filename;
      }
    } else if ((char === " " || char === "\t") && !inSingleQuote && !inDoubleQuote) {
      // Whitespace outside quotes - end current argument
      if (currentArg.length > 0) {
        args.push(currentArg);
        currentArg = "";
      }
      i++;
    } else {
      // Regular character (or whitespace inside quotes)
      currentArg += char;
      i++;
    }
  }
  
  // Push the last argument if any
  if (currentArg.length > 0) {
    args.push(currentArg);
  }
  
  return { args, redirectOutput, redirectError, appendOutput, appendError };
}

function executeCommand(commandLine) {
  // Parse the command and arguments with quote handling
  const parsed = parseCommandLine(commandLine.trim());
  const parts = parsed.args;
  const redirectOutput = parsed.redirectOutput;
  const redirectError = parsed.redirectError;
  const appendOutput = parsed.appendOutput;
  const appendError = parsed.appendError;
  
  // Debug logging
  console.error(`DEBUG: parsed =`, JSON.stringify(parsed));
  
  if (parts.length === 0) {
    return;
  }
  
  const command = parts[0];
  const args = parts.slice(1);
  
  // Find the executable in PATH
  const executablePath = findExecutableInPath(command);
  
  if (!executablePath) {
    console.log(`${command}: command not found`);
    return;
  }
  
  // Set up spawn options
  const spawnOptions = {
    argv0: command,   // Set argv[0] to the command name, not the full path
  };
  
  // Determine stdout file descriptor
  let stdoutFd = 'inherit';
  if (redirectOutput) {
    const dir = path.dirname(redirectOutput);
    if (dir && dir !== '.' && !fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    stdoutFd = fs.openSync(redirectOutput, 'w');
  } else if (appendOutput) {
    const dir = path.dirname(appendOutput);
    if (dir && dir !== '.' && !fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    stdoutFd = fs.openSync(appendOutput, 'a');
  }
  
  // Determine stderr file descriptor
  let stderrFd = 'inherit';
  if (redirectError) {
    const dir = path.dirname(redirectError);
    if (dir && dir !== '.' && !fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    stderrFd = fs.openSync(redirectError, 'w');
  } else if (appendError) {
    const dir = path.dirname(appendError);
    if (dir && dir !== '.' && !fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    stderrFd = fs.openSync(appendError, 'a');
  }
  
  // Set stdio
  spawnOptions.stdio = ['inherit', stdoutFd, stderrFd];
  
  // Execute the command with arguments
  const result = spawnSync(executablePath, args, spawnOptions);
  
  // If there was an error spawning the process, handle it
  if (result.error) {
    console.log(`${command}: command not found`);
  }
}

function prompt() {
  rl.question("$ ", (command) => {
    // Trim the command to remove extra whitespace
    const trimmedCommand = command.trim();
    
    // Check if the command is "exit"
    if (trimmedCommand === "exit") {
      process.exit(0);
    }
    
    // Check if the command starts with "echo"
    if (trimmedCommand.startsWith("echo ") || trimmedCommand === "echo") {
      // Parse the full command line to handle quotes and redirection
      const parsed = parseCommandLine(trimmedCommand);
      const parts = parsed.args;
      const redirectOutput = parsed.redirectOutput;
      const redirectError = parsed.redirectError;
      const appendOutput = parsed.appendOutput;
      const appendError = parsed.appendError;
      
      let output = "";
      if (parts.length > 1) {
        // Join all arguments after "echo" with spaces
        output = parts.slice(1).join(" ");
      }
      
      if (redirectOutput) {
        // Write to file (stdout redirect - overwrite)
        fs.writeFileSync(redirectOutput, output + '\n');
      } else if (appendOutput) {
        // Append to file (stdout redirect - append)
        fs.appendFileSync(appendOutput, output + '\n');
      } else {
        // Print to stdout
        console.log(output);
      }
      
      // If stderr is redirected, create an empty file (echo doesn't write to stderr)
      if (redirectError) {
        fs.writeFileSync(redirectError, '');
      } else if (appendError) {
        // For append, we still create/touch the file but don't add content
        fs.appendFileSync(appendError, '');
      }
      
      prompt();
      return;
    }
    
    // Check if the command starts with "type"
    if (trimmedCommand.startsWith("type ")) {
      // Extract the argument after "type "
      const arg = trimmedCommand.slice(5).trim();
      
      // List of builtin commands
      const builtins = ["echo", "exit", "type"];
      
      // First, check if it's a builtin
      if (builtins.includes(arg)) {
        console.log(`${arg} is a shell builtin`);
      } else {
        // Search for executable in PATH
        const executablePath = findExecutableInPath(arg);
        
        if (executablePath) {
          console.log(`${arg} is ${executablePath}`);
        } else {
          console.log(`${arg}: not found`);
        }
      }
      prompt();
      return;
    }
    
    // Try to execute as external command
    executeCommand(trimmedCommand);
    
    // Loop back to prompt again
    prompt();
  });
}

// Start the REPL
prompt();