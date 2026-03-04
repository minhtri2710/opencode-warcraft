/**
 * Quote a single shell argument if it contains special characters.
 */
export function shellQuoteArg(arg: string): string {
  if (/^[A-Za-z0-9_./:=+-]+$/.test(arg)) {
    return arg;
  }
  return `'${arg.replace(/'/g, "'\"'\"'")}'`;
}

/**
 * Convert a structured command + args into a shell command string.
 */
export function structuredToCommandString(command: string, args: string[]): string {
  return [command, ...args.map(shellQuoteArg)].join(' ');
}
