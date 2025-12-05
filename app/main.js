const readline = require("readline");

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

function prompt() {
  rl.question("$ ", (command) => {
    // Check if the command is "exit"
    if (command === "exit") {
      process.exit(0);
    }
    
    // Print the "command not found" message
    console.log(`${command}: command not found`);
    
    // Loop back to prompt again
    prompt();
  });
}

// Start the REPL
prompt();