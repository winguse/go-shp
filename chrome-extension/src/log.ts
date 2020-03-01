
const LOG_LEVELS = ['DEBUG', 'INFO', 'WARN', 'ERROR']
const [LOG_DEBUG, LOG_INFO, LOG_WARN, LOG_ERROR] = LOG_LEVELS;
const LOG_LEVEL = LOG_DEBUG;

function makeLogFunc(level, func = console.log) {
  return LOG_LEVELS.indexOf(level) >= LOG_LEVELS.indexOf(LOG_LEVEL) ? func.bind(window.console, level) : () => { };
}

export interface Logger {
  debug: (message?: any, ...optionalParams: any[]) => void
  info: (message?: any, ...optionalParams: any[]) => void
  warn: (message?: any, ...optionalParams: any[]) => void
  error: (message?: any, ...optionalParams: any[]) => void
}

const logger: Logger = {
  debug: makeLogFunc(LOG_DEBUG),
  info: makeLogFunc(LOG_INFO),
  warn: makeLogFunc(LOG_WARN, console.error),
  error: makeLogFunc(LOG_ERROR, console.error),
};


export default logger;