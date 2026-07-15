import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const fileInput = /type\s*=\s*(?:"file"|'file'|\{\s*(?:"file"|'file')\s*\})/

function sourceFiles(root: string): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = join(root, entry.name)
    if (entry.isDirectory()) return sourceFiles(path)
    return /\.(?:ts|tsx)$/.test(entry.name) ? [path] : []
  })
}

function operationalMediaFindings(source: string): string[] {
  return [
    fileInput.test(source) ? 'file input' : null,
    /getUserMedia/.test(source) ? 'getUserMedia' : null,
    /MediaRecorder/.test(source) ? 'MediaRecorder' : null,
    /["'`]\/api\/sessions\/\$\{[^}]+\}\/capture["'`]/.test(source) ? 'capture request' : null,
    /\bphotoAsk\b/.test(source) ? 'photoAsk' : null,
  ].filter((finding): finding is string => finding !== null)
}

describe('active source has no operational media control', () => {
  it.each([
    '<input type="file" />',
    "<input type='file' />",
    '<input type={"file"} />',
    "<input type={'file'} />",
    '<input\n type =\n "file" />',
  ])('detects file-input fixture %s', (fixture) => {
    expect(fileInput.test(fixture)).toBe(true)
  })

  it('rejects media capture APIs and active capture calls across app and components', () => {
    const findings = sourceFiles('app').concat(sourceFiles('components')).flatMap((path) =>
      operationalMediaFindings(readFileSync(path, 'utf8')).map((finding) => `${path}: ${finding}`),
    )
    expect(findings).toEqual([])
  })
})
