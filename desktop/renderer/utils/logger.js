const isDebugEnabled = process.env.NODE_ENV !== 'production';

function createLogger(namespace) {
  const prefix = namespace ? `[${namespace}]` : '';

  return {
    debug: (...args) => {
      if (isDebugEnabled) {
        console.debug(prefix, ...args);
      }
    },
    info: (...args) => {
      console.info(prefix, ...args);
    },
    warn: (...args) => {
      console.warn(prefix, ...args);
    },
    error: (...args) => {
      console.error(prefix, ...args);
    },
  };
}

export { createLogger };