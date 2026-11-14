// Run the same controller/resume regressions in PR checks and OTA packaging.
Promise.all([import('../scripts/mobile-runtime/scripts/update-controller.test.mjs'),import('../scripts/mobile-runtime/scripts/update-resume.test.mjs')]);
