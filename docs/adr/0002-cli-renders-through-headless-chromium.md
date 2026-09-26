# The CLI renders by driving the web page in headless Chromium with SwiftShader

The agent-facing CLI must show exactly what a person sees in the web previewer, so it loads `headless.html` (same `WrapViewer`, materials and lighting) in Playwright's Chromium instead of re-implementing rendering with headless-gl in Node. SwiftShader is forced even when a GPU exists so the same wrap renders to the same pixels on every machine, which lets agents compare iterations. The cost is a Chromium download (`npx playwright install chromium`) and a few seconds of start-up per command.
