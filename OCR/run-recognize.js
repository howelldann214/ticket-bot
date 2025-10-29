const fs = require('fs')
const path = require('path')
const { recognize } = require('./index')

const file = process.argv[2]
if (!file) {
  console.error('Usage: node run-recognize.js <file.svg>')
  process.exit(1)
}

const svgPath = path.resolve(file)
let svg
try {
  svg = fs.readFileSync(svgPath, 'utf8')
} catch (err) {
  console.error('read file error', err.message)
  process.exit(2)
}

try {
  const text = recognize(svg)
  console.log('recognized:', text)
} catch (err) {
  console.error('recognize error', err && err.stack ? err.stack : err)
  process.exit(3)
}
