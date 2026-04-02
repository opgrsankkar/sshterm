#!/usr/bin/env node

/* eslint-disable @typescript-eslint/explicit-function-return-type */

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const targetVersion = process.argv[2]

function fail(message, extra = {}) {
  console.error(
    JSON.stringify(
      {
        ok: false,
        error: message,
        ...extra
      },
      null,
      2
    )
  )
  process.exit(1)
}

function parseVersion(input) {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/.exec(input)

  if (!match) {
    return null
  }

  return {
    raw: input,
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] ? match[4].split('.') : []
  }
}

function compareIdentifiers(left, right) {
  const leftIsNumeric = /^\d+$/.test(left)
  const rightIsNumeric = /^\d+$/.test(right)

  if (leftIsNumeric && rightIsNumeric) {
    return Number(left) - Number(right)
  }

  if (leftIsNumeric) {
    return -1
  }

  if (rightIsNumeric) {
    return 1
  }

  if (left < right) {
    return -1
  }

  if (left > right) {
    return 1
  }

  return 0
}

function compareVersions(left, right) {
  for (const key of ['major', 'minor', 'patch']) {
    if (left[key] !== right[key]) {
      return left[key] - right[key]
    }
  }

  const leftHasPrerelease = left.prerelease.length > 0
  const rightHasPrerelease = right.prerelease.length > 0

  if (!leftHasPrerelease && !rightHasPrerelease) {
    return 0
  }

  if (!leftHasPrerelease) {
    return 1
  }

  if (!rightHasPrerelease) {
    return -1
  }

  const maxLength = Math.max(left.prerelease.length, right.prerelease.length)

  for (let index = 0; index < maxLength; index += 1) {
    const leftIdentifier = left.prerelease[index]
    const rightIdentifier = right.prerelease[index]

    if (leftIdentifier === undefined) {
      return -1
    }

    if (rightIdentifier === undefined) {
      return 1
    }

    const comparison = compareIdentifiers(leftIdentifier, rightIdentifier)

    if (comparison !== 0) {
      return comparison
    }
  }

  return 0
}

function normalizeTagVersion(tag) {
  return tag.startsWith('v') ? tag.slice(1) : tag
}

function getJsonFile(relativePath) {
  const fullPath = path.resolve(process.cwd(), relativePath)
  return JSON.parse(readFileSync(fullPath, 'utf8'))
}

function getLatestTag() {
  const output = execFileSync('git', ['tag', '--sort=version:refname'], {
    cwd: process.cwd(),
    encoding: 'utf8'
  }).trim()

  if (!output) {
    return null
  }

  const tags = output.split('\n').filter(Boolean)
  return tags.at(-1) ?? null
}

if (!targetVersion) {
  fail('Missing target version argument.')
}

const parsedTarget = parseVersion(targetVersion)

if (!parsedTarget) {
  fail('Target version must be valid semver with optional prerelease identifiers.', {
    targetVersion
  })
}

const packageJson = getJsonFile('package.json')
const packageLockJson = getJsonFile('package-lock.json')
const currentVersion = packageJson.version
const lockfileVersion = packageLockJson?.packages?.['']?.version ?? packageLockJson.version ?? null

const parsedCurrent = parseVersion(currentVersion)

if (!parsedCurrent) {
  fail('package.json version is not valid semver.', {
    currentVersion
  })
}

const latestTag = getLatestTag()
const latestTagVersion = latestTag ? normalizeTagVersion(latestTag) : null
const parsedLatestTag = latestTagVersion ? parseVersion(latestTagVersion) : null

if (latestTagVersion && !parsedLatestTag) {
  fail('Latest git tag is not valid semver after removing the leading v.', {
    latestTag,
    latestTagVersion
  })
}

const targetGreaterThanCurrent = compareVersions(parsedTarget, parsedCurrent) > 0
const targetGreaterThanLatestTag = parsedLatestTag
  ? compareVersions(parsedTarget, parsedLatestTag) > 0
  : true

const result = {
  ok: targetGreaterThanCurrent && targetGreaterThanLatestTag,
  targetVersion,
  currentVersion,
  lockfileVersion,
  packageLockMatchesPackageJson: lockfileVersion === currentVersion,
  latestTag,
  latestTagVersion,
  targetGreaterThanCurrent,
  targetGreaterThanLatestTag,
  changesRange: latestTag ? `${latestTag}..HEAD` : 'HEAD',
  nextTag: `v${targetVersion}`
}

if (!result.ok) {
  console.error(JSON.stringify(result, null, 2))
  process.exit(1)
}

console.log(JSON.stringify(result, null, 2))
