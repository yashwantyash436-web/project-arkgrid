// Vitest's installer check mis-resolves packages through the invalid host-level C:\package.json.
process.env.VITEST_SKIP_INSTALL_CHECKS = '1'

export default {
  test: {
    environment: 'jsdom',
  },
}
