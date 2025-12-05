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

function executeCommand(commandLine) {
  // Parse the command and arguments
  const parts = commandLine.trim().split(/\s+/);
  const command = parts[0];
  const args = parts.slice(1);
  
  // Find the executable in PATH
  const executablePath = findExecutableInPath(command);
  
  if (!executablePath) {
    console.log(`${command}: command not found`);
    return;
  }
  
  // Execute the command with arguments
  const result = spawnSync(executablePath, args, {
    stdio: "inherit", // This passes stdin/stdout/stderr to the child process
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
    if (trimmedCommand.startsWith("echo ")) {
      // Extract everything after "echo "
      const args = trimmedCommand.slice(5);
      console.log(args);
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