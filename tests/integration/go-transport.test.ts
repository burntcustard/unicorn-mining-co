export {};

if (process.platform === 'linux') {
  await import('../support/go-transport-check.ts');
}
