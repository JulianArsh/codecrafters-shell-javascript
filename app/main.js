const readline = require("readline");

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

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
      
      if (builtins.includes(arg)) {
        console.log(`${arg} is a shell builtin`);
      } else {
        console.log(`${arg}: not found`);
      }
      prompt();
      return;
    }
    
    // Print the "command not found" message
    console.log(`${trimmedCommand}: command not found`);
    
    // Loop back to prompt again
    prompt();
  });
}

// Start the REPL
prompt();