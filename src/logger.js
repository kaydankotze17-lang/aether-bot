const levels = {
  info: "INFO",
  warn: "WARN",
  error: "ERROR",
};

function stamp() {
  return new Date().toISOString();
}

function write(level, args) {
  const prefix = `[${stamp()}] [${levels[level]}]`;
  const line = args
    .map((arg) => {
      if (arg instanceof Error) {
        return arg.stack || arg.message;
      }
      if (typeof arg === "object") {
        try {
          return JSON.stringify(arg);
        } catch {
          return String(arg);
        }
      }
      return String(arg);
    })
    .join(" ");

  if (level === "error") {
    console.error(prefix, line);
  } else if (level === "warn") {
    console.warn(prefix, line);
  } else {
    console.log(prefix, line);
  }
}

export const logger = {
  info: (...args) => write("info", args),
  warn: (...args) => write("warn", args),
  error: (...args) => write("error", args),
};
