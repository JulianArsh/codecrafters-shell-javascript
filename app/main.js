const readline = require("readline");
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const { Writable, Readable } = require("stream");

let rlGlobal = null;
let lastLine = null;
let lastMatches = null;
let commandHistory = [];
let lastAppendedIndex = 0;

// Load history from HISTFILE on startup
function loadHistoryFromFile() {
  const histfile = process.env.HISTFILE;

  if (histfile) {
    try {
      if (fs.existsSync(histfile)) {
        const historyContent = fs.readFileSync(histfile, "utf-8");
        const lines = historyContent.split("\n");

        for (const line of lines) {
          const trimmedLine = line.trim();

          if (trimmedLine.length > 0) {
            commandHistory.push(trimmedLine);
          }
        }

        lastAppendedIndex = commandHistory.length;
      }
    } catch (err) {
      // Silently fail if we can't read the history file
    }
  }
}

// Save history to HISTFILE on exit
function saveHistoryToFile() {
  const histfile = process.env.HISTFILE;

  if (histfile) {
    try {
      const dir = path.dirname(histfile);

      if (dir && dir !== "." && !fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      const historyContent = commandHistory.join("\n") + "\n";

      fs.writeFileSync(histfile, historyContent, "utf-8");
    } catch (err) {
      // Silently fail if we can't write the history file
    }
  }
}

function completer(line) {
  const builtins = ["cd", "echo", "exit", "pwd", "type", "history"];

  // ------------------------------------------------------------
  // Command completion
  // ------------------------------------------------------------

  if (!line.includes(" ")) {
    let hits = builtins.filter((cmd) => cmd.startsWith(line));

    const pathEnv = process.env.PATH || "";
    const directories = pathEnv.split(path.delimiter);
    const foundExecutables = new Set();

    for (const dir of directories) {
      try {
        if (!fs.existsSync(dir)) {
          continue;
        }

        const files = fs.readdirSync(dir);

        for (const file of files) {
          if (file.startsWith(line)) {
            const fullPath = path.join(dir, file);

            try {
              fs.accessSync(fullPath, fs.constants.X_OK);

              if (!builtins.includes(file)) {
                foundExecutables.add(file);
              }
            } catch (err) {
              continue;
            }
          }
        }
      } catch (err) {
        continue;
      }
    }

    hits = hits.concat(Array.from(foundExecutables));
    hits.sort();
    hits = [...new Set(hits)];

    if (hits.length === 0) {
      if (rlGlobal && rlGlobal.output) {
        rlGlobal.output.write("\x07");
      } else {
        process.stdout.write("\x07");
      }

      lastLine = null;
      lastMatches = null;

      return [[], line];
    }

    if (hits.length === 1) {
      lastLine = null;
      lastMatches = null;

      return [[hits[0] + " "], line];
    }

    let commonPrefix = hits[0];

    for (let i = 1; i < hits.length; i++) {
      let j = 0;

      while (
        j < commonPrefix.length &&
        j < hits[i].length &&
        commonPrefix[j] === hits[i][j]
      ) {
        j++;
      }

      commonPrefix = commonPrefix.substring(0, j);
    }

    if (commonPrefix.length > line.length) {
      lastLine = null;
      lastMatches = null;

      return [[commonPrefix], line];
    }

    if (
      lastLine === line &&
      lastMatches &&
      JSON.stringify(lastMatches) === JSON.stringify(hits)
    ) {
      console.log();
      console.log(hits.join("  "));

      if (rlGlobal) {
        rlGlobal._refreshLine();
      }

      lastLine = null;
      lastMatches = null;

      return [[], line];
    }

    if (rlGlobal && rlGlobal.output) {
      rlGlobal.output.write("\x07");
    } else {
      process.stdout.write("\x07");
    }

    lastLine = line;
    lastMatches = hits;

    return [[], line];
  }

  // ------------------------------------------------------------
  // Filename completion
  // ------------------------------------------------------------

  const lastSpaceIndex = line.lastIndexOf(" ");

  // Everything after the last space is the filename/path
  // currently being completed.
  const partialPath = line.substring(lastSpaceIndex + 1);

  // Find the final slash.
  //
  // Example:
  // path/to/f
  //
  // directoryPath = path/to/
  // prefix        = f
  const lastSlashIndex = partialPath.lastIndexOf("/");

  let directoryPath;
  let prefix;

  if (lastSlashIndex !== -1) {
    directoryPath = partialPath.substring(0, lastSlashIndex + 1);
    prefix = partialPath.substring(lastSlashIndex + 1);
  } else {
    directoryPath = "";
    prefix = partialPath;
  }

  try {
    // The directory path is relative to the shell's current
    // working directory.
    //
    // Example:
    // cwd = /home/user
    // directoryPath = path/to/
    //
    // searchDirectory = /home/user/path/to/
    const searchDirectory = directoryPath
      ? path.resolve(process.cwd(), directoryPath)
      : process.cwd();

    const files = fs.readdirSync(searchDirectory);

    // Find entries beginning with the typed prefix.
    const matches = files.filter((file) => file.startsWith(prefix));

    // This stage only requires exactly one match.
    if (matches.length === 1) {
      const completedPath = directoryPath + matches[0];

      lastLine = null;
      lastMatches = null;

      // Replace the entire partial path with the completed path
      // and add the required trailing space.
      return [[completedPath + " "], partialPath];
    }
  } catch (err) {
    // Directory doesn't exist or cannot be read.
  }

  lastLine = null;
  lastMatches = null;

  return [[], line];
}

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  completer: completer,
  terminal: true,
});

rlGlobal = rl;

function findExecutableInPath(command) {
  const pathEnv = process.env.PATH || "";
  const directories = pathEnv.split(path.delimiter);

  for (const dir of directories) {
    const fullPath = path.join(dir, command);

    try {
      if (fs.existsSync(fullPath)) {
        try {
          fs.accessSync(fullPath, fs.constants.X_OK);
          return fullPath;
        } catch (err) {
          continue;
        }
      }
    } catch (err) {
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

    if (char === "\\" && !inSingleQuote && inDoubleQuote) {
      i++;

      if (i < commandLine.length) {
        const nextChar = commandLine[i];

        if (
          nextChar === '"' ||
          nextChar === "\\" ||
          nextChar === "$" ||
          nextChar === "`"
        ) {
          currentArg += nextChar;
          i++;
        } else {
          currentArg += "\\" + nextChar;
          i++;
        }
      }
    } else if (char === "\\" && !inSingleQuote && !inDoubleQuote) {
      i++;

      if (i < commandLine.length) {
        currentArg += commandLine[i];
        i++;
      }
    } else if (char === "'" && !inDoubleQuote) {
      inSingleQuote = !inSingleQuote;
      i++;
    } else if (char === '"' && !inSingleQuote) {
      inDoubleQuote = !inDoubleQuote;
      i++;
    } else if (
      char === ">" &&
      !inSingleQuote &&
      !inDoubleQuote
    ) {
      if (
        i + 1 < commandLine.length &&
        commandLine[i + 1] === ">"
      ) {
        if (currentArg.length > 0) {
          args.push(currentArg);
          currentArg = "";
        }

        i += 2;

        while (
          i < commandLine.length &&
          (commandLine[i] === " " ||
            commandLine[i] === "\t")
        ) {
          i++;
        }

        let filename = "";
        let inFileQuote = false;
        let fileQuoteChar = null;

        while (i < commandLine.length) {
          const c = commandLine[i];

          if (
            (c === '"' || c === "'") &&
            !inFileQuote
          ) {
            inFileQuote = true;
            fileQuoteChar = c;
            i++;
          } else if (
            c === fileQuoteChar &&
            inFileQuote
          ) {
            inFileQuote = false;
            fileQuoteChar = null;
            i++;
          } else if (
            (c === " " || c === "\t") &&
            !inFileQuote
          ) {
            break;
          } else {
            filename += c;
            i++;
          }
        }

        appendOutput = filename;
      } else {
        if (currentArg.length > 0) {
          args.push(currentArg);
          currentArg = "";
        }

        i++;

        while (
          i < commandLine.length &&
          (commandLine[i] === " " ||
            commandLine[i] === "\t")
        ) {
          i++;
        }

        let filename = "";
        let inFileQuote = false;
        let fileQuoteChar = null;

        while (i < commandLine.length) {
          const c = commandLine[i];

          if (
            (c === '"' || c === "'") &&
            !inFileQuote
          ) {
            inFileQuote = true;
            fileQuoteChar = c;
            i++;
          } else if (
            c === fileQuoteChar &&
            inFileQuote
          ) {
            inFileQuote = false;
            fileQuoteChar = null;
            i++;
          } else if (
            (c === " " || c === "\t") &&
            !inFileQuote
          ) {
            break;
          } else {
            filename += c;
            i++;
          }
        }

        redirectOutput = filename;
      }
    } else if (
      char === "2" &&
      !inSingleQuote &&
      !inDoubleQuote &&
      i + 1 < commandLine.length &&
      commandLine[i + 1] === ">"
    ) {
      if (
        i + 2 < commandLine.length &&
        commandLine[i + 2] === ">"
      ) {
        if (currentArg.length > 0) {
          args.push(currentArg);
          currentArg = "";
        }

        i += 3;

        while (
          i < commandLine.length &&
          (commandLine[i] === " " ||
            commandLine[i] === "\t")
        ) {
          i++;
        }

        let filename = "";
        let inFileQuote = false;
        let fileQuoteChar = null;

        while (i < commandLine.length) {
          const c = commandLine[i];

          if (
            (c === '"' || c === "'") &&
            !inFileQuote
          ) {
            inFileQuote = true;
            fileQuoteChar = c;
            i++;
          } else if (
            c === fileQuoteChar &&
            inFileQuote
          ) {
            inFileQuote = false;
            fileQuoteChar = null;
            i++;
          } else if (
            (c === " " || c === "\t") &&
            !inFileQuote
          ) {
            break;
          } else {
            filename += c;
            i++;
          }
        }

        appendError = filename;
      } else {
        if (currentArg.length > 0) {
          args.push(currentArg);
          currentArg = "";
        }

        i += 2;

        while (
          i < commandLine.length &&
          (commandLine[i] === " " ||
            commandLine[i] === "\t")
        ) {
          i++;
        }

        let filename = "";
        let inFileQuote = false;
        let fileQuoteChar = null;

        while (i < commandLine.length) {
          const c = commandLine[i];

          if (
            (c === '"' || c === "'") &&
            !inFileQuote
          ) {
            inFileQuote = true;
            fileQuoteChar = c;
            i++;
          } else if (
            c === fileQuoteChar &&
            inFileQuote
          ) {
            inFileQuote = false;
            fileQuoteChar = null;
            i++;
          } else if (
            (c === " " || c === "\t") &&
            !inFileQuote
          ) {
            break;
          } else {
            filename += c;
            i++;
          }
        }

        redirectError = filename;
      }
    } else if (
      char === "1" &&
      !inSingleQuote &&
      !inDoubleQuote &&
      i + 1 < commandLine.length &&
      commandLine[i + 1] === ">"
    ) {
      if (
        i + 2 < commandLine.length &&
        commandLine[i + 2] === ">"
      ) {
        if (currentArg.length > 0) {
          args.push(currentArg);
          currentArg = "";
        }

        i += 3;

        while (
          i < commandLine.length &&
          (commandLine[i] === " " ||
            commandLine[i] === "\t")
        ) {
          i++;
        }

        let filename = "";
        let inFileQuote = false;
        let fileQuoteChar = null;

        while (i < commandLine.length) {
          const c = commandLine[i];

          if (
            (c === '"' || c === "'") &&
            !inFileQuote
          ) {
            inFileQuote = true;
            fileQuoteChar = c;
            i++;
          } else if (
            c === fileQuoteChar &&
            inFileQuote
          ) {
            inFileQuote = false;
            fileQuoteChar = null;
            i++;
          } else if (
            (c === " " || c === "\t") &&
            !inFileQuote
          ) {
            break;
          } else {
            filename += c;
            i++;
          }
        }

        appendOutput = filename;
      } else {
        if (currentArg.length > 0) {
          args.push(currentArg);
          currentArg = "";
        }

        i += 2;

        while (
          i < commandLine.length &&
          (commandLine[i] === " " ||
            commandLine[i] === "\t")
        ) {
          i++;
        }

        let filename = "";
        let inFileQuote = false;
        let fileQuoteChar = null;

        while (i < commandLine.length) {
          const c = commandLine[i];

          if (
            (c === '"' || c === "'") &&
            !inFileQuote
          ) {
            inFileQuote = true;
            fileQuoteChar = c;
            i++;
          } else if (
            c === fileQuoteChar &&
            inFileQuote
          ) {
            inFileQuote = false;
            fileQuoteChar = null;
            i++;
          } else if (
            (c === " " || c === "\t") &&
            !inFileQuote
          ) {
            break;
          } else {
            filename += c;
            i++;
          }
        }

        redirectOutput = filename;
      }
    } else if (
      (char === " " || char === "\t") &&
      !inSingleQuote &&
      !inDoubleQuote
    ) {
      if (currentArg.length > 0) {
        args.push(currentArg);
        currentArg = "";
      }

      i++;
    } else {
      currentArg += char;
      i++;
    }
  }

  if (currentArg.length > 0) {
    args.push(currentArg);
  }

  return {
    args,
    redirectOutput,
    redirectError,
    appendOutput,
    appendError,
  };
}

function splitByPipe(commandLine) {
  const commands = [];

  let currentCmd = "";
  let inSingleQuote = false;
  let inDoubleQuote = false;

  for (let i = 0; i < commandLine.length; i++) {
    const char = commandLine[i];

    if (char === "'" && !inDoubleQuote) {
      inSingleQuote = !inSingleQuote;
      currentCmd += char;
    } else if (char === '"' && !inSingleQuote) {
      inDoubleQuote = !inDoubleQuote;
      currentCmd += char;
    } else if (
      char === "|" &&
      !inSingleQuote &&
      !inDoubleQuote
    ) {
      commands.push(currentCmd.trim());
      currentCmd = "";
    } else {
      currentCmd += char;
    }
  }

  if (currentCmd.trim().length > 0) {
    commands.push(currentCmd.trim());
  }

  return commands;
}

const builtins = [
  "cd",
  "echo",
  "exit",
  "pwd",
  "type",
  "history",
];

function isBuiltin(command) {
  return builtins.includes(command);
}

function executeBuiltin(
  command,
  args,
  inputData,
  outputStream
) {
  switch (command) {
    case "echo": {
      const output = args.join(" ");
      outputStream.write(output + "\n");
      break;
    }

    case "pwd":
      outputStream.write(process.cwd() + "\n");
      break;

    case "type": {
      if (args.length > 0) {
        const arg = args[0];

        if (builtins.includes(arg)) {
          outputStream.write(
            `${arg} is a shell builtin\n`
          );
        } else {
          const executablePath =
            findExecutableInPath(arg);

          if (executablePath) {
            outputStream.write(
              `${arg} is ${executablePath}\n`
            );
          } else {
            outputStream.write(
              `${arg}: not found\n`
            );
          }
        }
      }

      break;
    }

    case "history": {
      if (
        args.length > 0 &&
        args[0] === "-r"
      ) {
        if (args.length > 1) {
          const historyFilePath = args[1];

          try {
            if (fs.existsSync(historyFilePath)) {
              const historyContent =
                fs.readFileSync(
                  historyFilePath,
                  "utf-8"
                );

              const lines =
                historyContent.split("\n");

              for (const line of lines) {
                const trimmedLine = line.trim();

                if (trimmedLine.length > 0) {
                  commandHistory.push(
                    trimmedLine
                  );
                }
              }

              lastAppendedIndex =
                commandHistory.length;
            }
          } catch (err) {
            outputStream.write(
              `history: cannot read ${historyFilePath}: ${err.message}\n`
            );
          }
        }
      } else if (
        args.length > 0 &&
        args[0] === "-w"
      ) {
        if (args.length > 1) {
          const historyFilePath = args[1];

          try {
            const dir =
              path.dirname(historyFilePath);

            if (
              dir &&
              dir !== "." &&
              !fs.existsSync(dir)
            ) {
              fs.mkdirSync(dir, {
                recursive: true,
              });
            }

            const historyContent =
              commandHistory.join("\n") + "\n";

            fs.writeFileSync(
              historyFilePath,
              historyContent,
              "utf-8"
            );

            lastAppendedIndex =
              commandHistory.length;
          } catch (err) {
            outputStream.write(
              `history: cannot write ${historyFilePath}: ${err.message}\n`
            );
          }
        }
      } else if (
        args.length > 0 &&
        args[0] === "-a"
      ) {
        if (args.length > 1) {
          const historyFilePath = args[1];

          try {
            const dir =
              path.dirname(historyFilePath);

            if (
              dir &&
              dir !== "." &&
              !fs.existsSync(dir)
            ) {
              fs.mkdirSync(dir, {
                recursive: true,
              });
            }

            const newCommands =
              commandHistory.slice(
                lastAppendedIndex
              );

            if (newCommands.length > 0) {
              const contentToAppend =
                newCommands.join("\n") + "\n";

              fs.appendFileSync(
                historyFilePath,
                contentToAppend,
                "utf-8"
              );
            }

            lastAppendedIndex =
              commandHistory.length;
          } catch (err) {
            outputStream.write(
              `history: cannot append to ${historyFilePath}: ${err.message}\n`
            );
          }
        }
      } else {
        let limit = commandHistory.length;

        if (args.length > 0) {
          const n = parseInt(args[0], 10);

          if (!isNaN(n) && n > 0) {
            limit = n;
          }
        }

        const startIndex = Math.max(
          0,
          commandHistory.length - limit
        );

        for (
          let i = startIndex;
          i < commandHistory.length;
          i++
        ) {
          outputStream.write(
            `    ${i + 1}  ${commandHistory[i]}\n`
          );
        }
      }

      break;
    }

    case "cd": {
      let targetDir;

      if (args.length === 0) {
        targetDir = process.env.HOME || "/";
      } else if (args[0] === "~") {
        targetDir = process.env.HOME || "/";
      } else if (args[0].startsWith("~/")) {
        targetDir = path.join(
          process.env.HOME || "/",
          args[0].slice(2)
        );
      } else {
        targetDir = args[0];
      }

      try {
        process.chdir(targetDir);
      } catch (err) {
        outputStream.write(
          `cd: ${targetDir}: No such file or directory\n`
        );
      }

      break;
    }

    case "exit": {
      saveHistoryToFile();

      const exitCode =
        args.length > 0
          ? parseInt(args[0], 10) || 0
          : 0;

      process.exit(exitCode);
      break;
    }
  }
}

function executePipeline(commandLine, callback) {
  const commands = splitByPipe(commandLine);

  if (commands.length === 0) {
    callback();
    return;
  }

  if (commands.length === 1) {
    executeSingleCommand(
      commands[0],
      callback
    );
    return;
  }

  const parsedCommands = commands.map((cmd) => {
    const parsed = parseCommandLine(cmd);

    return {
      command: parsed.args[0],
      args: parsed.args.slice(1),
      isBuiltin: isBuiltin(parsed.args[0]),
    };
  });

  let currentInput = null;
  const processes = [];

  for (
    let i = 0;
    i < parsedCommands.length;
    i++
  ) {
    const {
      command,
      args,
      isBuiltin: isBuiltinCmd,
    } = parsedCommands[i];

    const isLast =
      i === parsedCommands.length - 1;

    const isFirst = i === 0;

    if (isBuiltinCmd) {
      if (isLast) {
        executeBuiltin(
          command,
          args,
          currentInput,
          process.stdout
        );

        if (
          currentInput &&
          currentInput.destroy
        ) {
          currentInput.on("data", () => {});
          currentInput.on("end", () => {});
        }
      } else {
        const chunks = [];

        const outputStream = new Writable({
          write(
            chunk,
            encoding,
            cb
          ) {
            chunks.push(chunk);
            cb();
          },
        });

        executeBuiltin(
          command,
          args,
          currentInput,
          outputStream
        );

        outputStream.end();

        const outputData =
          Buffer.concat(chunks);

        currentInput = new Readable({
          read() {
            this.push(outputData);
            this.push(null);
          },
        });
      }
    } else {
      const executablePath =
        findExecutableInPath(command);

      if (!executablePath) {
        console.log(
          `${command}: command not found`
        );

        callback();
        return;
      }

      const spawnOptions = {
        stdio: [
          isFirst ? "inherit" : "pipe",
          isLast ? "inherit" : "pipe",
          "inherit",
        ],
      };

      const proc = spawn(
        executablePath,
        args,
        spawnOptions
      );

      if (currentInput && !isFirst) {
        currentInput.pipe(proc.stdin);
      }

      if (!isLast) {
        currentInput = proc.stdout;
      }

      processes.push(proc);
    }
  }

  if (processes.length > 0) {
    let completed = 0;
    const total = processes.length;

    processes.forEach((proc) => {
      proc.on("close", () => {
        completed++;

        if (completed === total) {
          callback();
        }
      });

      proc.on("error", () => {
        completed++;

        if (completed === total) {
          callback();
        }
      });
    });
  } else {
    callback();
  }
}

function executeSingleCommand(
  commandLine,
  callback
) {
  const parsed = parseCommandLine(
    commandLine.trim()
  );

  const parts = parsed.args;

  const redirectOutput =
    parsed.redirectOutput;

  const redirectError =
    parsed.redirectError;

  const appendOutput =
    parsed.appendOutput;

  const appendError =
    parsed.appendError;

  if (parts.length === 0) {
    callback();
    return;
  }

  const command = parts[0];
  const args = parts.slice(1);

  if (isBuiltin(command)) {
    let outputStream = process.stdout;
    let outputFd = null;

    if (redirectOutput) {
      const dir = path.dirname(
        redirectOutput
      );

      if (
        dir &&
        dir !== "." &&
        !fs.existsSync(dir)
      ) {
        fs.mkdirSync(dir, {
          recursive: true,
        });
      }

      outputFd = fs.openSync(
        redirectOutput,
        "w"
      );

      outputStream =
        fs.createWriteStream(null, {
          fd: outputFd,
        });
    } else if (appendOutput) {
      const dir = path.dirname(
        appendOutput
      );

      if (
        dir &&
        dir !== "." &&
        !fs.existsSync(dir)
      ) {
        fs.mkdirSync(dir, {
          recursive: true,
        });
      }

      outputFd = fs.openSync(
        appendOutput,
        "a"
      );

      outputStream =
        fs.createWriteStream(null, {
          fd: outputFd,
        });
    }

    if (redirectError) {
      const dir = path.dirname(
        redirectError
      );

      if (
        dir &&
        dir !== "." &&
        !fs.existsSync(dir)
      ) {
        fs.mkdirSync(dir, {
          recursive: true,
        });
      }

      fs.writeFileSync(
        redirectError,
        ""
      );
    } else if (appendError) {
      const dir = path.dirname(
        appendError
      );

      if (
        dir &&
        dir !== "." &&
        !fs.existsSync(dir)
      ) {
        fs.mkdirSync(dir, {
          recursive: true,
        });
      }

      fs.appendFileSync(
        appendError,
        ""
      );
    }

    executeBuiltin(
      command,
      args,
      null,
      outputStream
    );

    if (outputFd !== null) {
      outputStream.end();
    }

    callback();
    return;
  }

  const executablePath =
    findExecutableInPath(command);

  if (!executablePath) {
    console.log(
      `${command}: command not found`
    );

    callback();
    return;
  }

  const spawnOptions = {
    argv0: command,
    stdio: [
      "inherit",
      "inherit",
      "inherit",
    ],
  };

  let stdoutFd = null;
  let stderrFd = null;

  if (redirectOutput) {
    const dir = path.dirname(
      redirectOutput
    );

    if (
      dir &&
      dir !== "." &&
      !fs.existsSync(dir)
    ) {
      fs.mkdirSync(dir, {
        recursive: true,
      });
    }

    stdoutFd = fs.openSync(
      redirectOutput,
      "w"
    );

    spawnOptions.stdio[1] = stdoutFd;
  } else if (appendOutput) {
    const dir = path.dirname(
      appendOutput
    );

    if (
      dir &&
      dir !== "." &&
      !fs.existsSync(dir)
    ) {
      fs.mkdirSync(dir, {
        recursive: true,
      });
    }

    stdoutFd = fs.openSync(
      appendOutput,
      "a"
    );

    spawnOptions.stdio[1] = stdoutFd;
  }

  if (redirectError) {
    const dir = path.dirname(
      redirectError
    );

    if (
      dir &&
      dir !== "." &&
      !fs.existsSync(dir)
    ) {
      fs.mkdirSync(dir, {
        recursive: true,
      });
    }

    stderrFd = fs.openSync(
      redirectError,
      "w"
    );

    spawnOptions.stdio[2] = stderrFd;
  } else if (appendError) {
    const dir = path.dirname(
      appendError
    );

    if (
      dir &&
      dir !== "." &&
      !fs.existsSync(dir)
    ) {
      fs.mkdirSync(dir, {
        recursive: true,
      });
    }

    stderrFd = fs.openSync(
      appendError,
      "a"
    );

    spawnOptions.stdio[2] = stderrFd;
  }

  const proc = spawn(
    executablePath,
    args,
    spawnOptions
  );

  proc.on("close", () => {
    if (stdoutFd !== null) {
      fs.closeSync(stdoutFd);
    }

    if (stderrFd !== null) {
      fs.closeSync(stderrFd);
    }

    callback();
  });

  proc.on("error", () => {
    console.log(
      `${command}: command not found`
    );

    if (stdoutFd !== null) {
      fs.closeSync(stdoutFd);
    }

    if (stderrFd !== null) {
      fs.closeSync(stderrFd);
    }

    callback();
  });
}

function prompt() {
  rl.question("$ ", (command) => {
    const trimmedCommand = command.trim();

    if (trimmedCommand.length === 0) {
      prompt();
      return;
    }

    commandHistory.push(trimmedCommand);

    if (trimmedCommand.includes("|")) {
      executePipeline(
        trimmedCommand,
        prompt
      );

      return;
    }

    if (
      trimmedCommand === "exit" ||
      trimmedCommand.startsWith("exit ")
    ) {
      saveHistoryToFile();

      const parts =
        trimmedCommand.split(/\s+/);

      const exitCode =
        parts.length > 1
          ? parseInt(parts[1], 10) || 0
          : 0;

      process.exit(exitCode);
    }

    if (trimmedCommand === "pwd") {
      console.log(process.cwd());
      prompt();
      return;
    }

    if (
      trimmedCommand === "history" ||
      trimmedCommand.startsWith("history ")
    ) {
      const parsed =
        parseCommandLine(trimmedCommand);

      const parts = parsed.args;

      if (
        parts.length > 1 &&
        parts[1] === "-r"
      ) {
        if (parts.length > 2) {
          const historyFilePath =
            parts[2];

          try {
            if (
              fs.existsSync(
                historyFilePath
              )
            ) {
              const historyContent =
                fs.readFileSync(
                  historyFilePath,
                  "utf-8"
                );

              const lines =
                historyContent.split("\n");

              for (const line of lines) {
                const trimmedLine =
                  line.trim();

                if (
                  trimmedLine.length > 0
                ) {
                  commandHistory.push(
                    trimmedLine
                  );
                }
              }

              lastAppendedIndex =
                commandHistory.length;
            }
          } catch (err) {
            console.log(
              `history: cannot read ${historyFilePath}: ${err.message}`
            );
          }
        }
      } else if (
        parts.length > 1 &&
        parts[1] === "-w"
      ) {
        if (parts.length > 2) {
          const historyFilePath =
            parts[2];

          try {
            const dir =
              path.dirname(
                historyFilePath
              );

            if (
              dir &&
              dir !== "." &&
              !fs.existsSync(dir)
            ) {
              fs.mkdirSync(dir, {
                recursive: true,
              });
            }

            const historyContent =
              commandHistory.join("\n") +
              "\n";

            fs.writeFileSync(
              historyFilePath,
              historyContent,
              "utf-8"
            );

            lastAppendedIndex =
              commandHistory.length;
          } catch (err) {
            console.log(
              `history: cannot write ${historyFilePath}: ${err.message}`
            );
          }
        }
      } else if (
        parts.length > 1 &&
        parts[1] === "-a"
      ) {
        if (parts.length > 2) {
          const historyFilePath =
            parts[2];

          try {
            const dir =
              path.dirname(
                historyFilePath
              );

            if (
              dir &&
              dir !== "." &&
              !fs.existsSync(dir)
            ) {
              fs.mkdirSync(dir, {
                recursive: true,
              });
            }

            const newCommands =
              commandHistory.slice(
                lastAppendedIndex
              );

            if (
              newCommands.length > 0
            ) {
              const contentToAppend =
                newCommands.join("\n") +
                "\n";

              fs.appendFileSync(
                historyFilePath,
                contentToAppend,
                "utf-8"
              );
            }

            lastAppendedIndex =
              commandHistory.length;
          } catch (err) {
            console.log(
              `history: cannot append to ${historyFilePath}: ${err.message}`
            );
          }
        }
      } else {
        let limit =
          commandHistory.length;

        if (parts.length > 1) {
          const n = parseInt(
            parts[1],
            10
          );

          if (!isNaN(n) && n > 0) {
            limit = n;
          }
        }

        const startIndex =
          Math.max(
            0,
            commandHistory.length -
              limit
          );

        for (
          let i = startIndex;
          i < commandHistory.length;
          i++
        ) {
          console.log(
            `    ${i + 1}  ${commandHistory[i]}`
          );
        }
      }

      prompt();
      return;
    }

    if (
      trimmedCommand === "cd" ||
      trimmedCommand.startsWith("cd ")
    ) {
      const parsed =
        parseCommandLine(trimmedCommand);

      const parts = parsed.args;

      let targetDir;

      if (parts.length === 1) {
        targetDir =
          process.env.HOME || "/";
      } else if (parts[1] === "~") {
        targetDir =
          process.env.HOME || "/";
      } else if (
        parts[1].startsWith("~/")
      ) {
        targetDir = path.join(
          process.env.HOME || "/",
          parts[1].slice(2)
        );
      } else {
        targetDir = parts[1];
      }

      try {
        process.chdir(targetDir);
      } catch (err) {
        console.log(
          `cd: ${targetDir}: No such file or directory`
        );
      }

      prompt();
      return;
    }

    if (
      trimmedCommand.startsWith("echo ") ||
      trimmedCommand === "echo"
    ) {
      const parsed =
        parseCommandLine(trimmedCommand);

      const parts = parsed.args;

      const redirectOutput =
        parsed.redirectOutput;

      const appendOutput =
        parsed.appendOutput;

      const redirectError =
        parsed.redirectError;

      const appendError =
        parsed.appendError;

      let output = "";

      if (parts.length > 1) {
        output = parts
          .slice(1)
          .join(" ");
      }

      if (redirectError) {
        const dir = path.dirname(
          redirectError
        );

        if (
          dir &&
          dir !== "." &&
          !fs.existsSync(dir)
        ) {
          fs.mkdirSync(dir, {
            recursive: true,
          });
        }

        fs.writeFileSync(
          redirectError,
          ""
        );
      } else if (appendError) {
        const dir = path.dirname(
          appendError
        );

        if (
          dir &&
          dir !== "." &&
          !fs.existsSync(dir)
        ) {
          fs.mkdirSync(dir, {
            recursive: true,
          });
        }

        fs.appendFileSync(
          appendError,
          ""
        );
      }

      if (redirectOutput) {
        const dir = path.dirname(
          redirectOutput
        );

        if (
          dir &&
          dir !== "." &&
          !fs.existsSync(dir)
        ) {
          fs.mkdirSync(dir, {
            recursive: true,
          });
        }

        fs.writeFileSync(
          redirectOutput,
          output + "\n"
        );
      } else if (appendOutput) {
        const dir = path.dirname(
          appendOutput
        );

        if (
          dir &&
          dir !== "." &&
          !fs.existsSync(dir)
        ) {
          fs.mkdirSync(dir, {
            recursive: true,
          });
        }

        fs.appendFileSync(
          appendOutput,
          output + "\n"
        );
      } else {
        console.log(output);
      }

      prompt();
      return;
    }

    if (
      trimmedCommand.startsWith("type ")
    ) {
      const arg =
        trimmedCommand
          .slice(5)
          .trim();

      if (builtins.includes(arg)) {
        console.log(
          `${arg} is a shell builtin`
        );
      } else {
        const executablePath =
          findExecutableInPath(arg);

        if (executablePath) {
          console.log(
            `${arg} is ${executablePath}`
          );
        } else {
          console.log(
            `${arg}: not found`
          );
        }
      }

      prompt();
      return;
    }

    executeSingleCommand(
      trimmedCommand,
      prompt
    );
  });
}

loadHistoryFromFile();
prompt();
