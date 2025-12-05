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
  let i = 0;
  
  while (i < commandLine.length) {
    const char = commandLine[i];
    
    if (char === '\\' && !inSingleQuote && inDoubleQuote) {
      // Backslash inside double quotes - only escape special characters
      i++; // Move past the backslash
      if (i < commandLine.length) {
        const nextChar = commandLine[i];
        // In double quotes, backslash only escapes: $ ` " \ and newline
        // For this stage, we'll escape: " \ and $
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
  
  return args;
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
      // Parse the full command line to handle quotes
      const parts = parseCommandLine(trimmedCommand);
      
      if (parts.length > 1) {
        // Join all arguments after "echo" with spaces
        const args = parts.slice(1).join(" ");
        console.log(args);
      } else {
        // Just "echo" with no arguments - print empty line
        console.log("");
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

function executeCommand(commandLine) {
  // Parse the command and arguments with quote handling
  const parts = parseCommandLine(commandLine.trim());
  
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
  
  // Execute the command with arguments
  // Use argv0 option to set the program name (argv[0])
  const result = spawnSync(executablePath, args, {
    stdio: "inherit", // This passes stdin/stdout/stderr to the child process
    argv0: command,   // Set argv[0] to the command name, not the full path
  });
  
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
      // Parse the full command line to handle quotes
      const parts = parseCommandLine(trimmedCommand);
      
      if (parts.length > 1) {
        // Join all arguments after "echo" with spaces
        const args = parts.slice(1).join(" ");
        console.log(args);
      } else {
        // Just "echo" with no arguments - print empty line
        console.log("");
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