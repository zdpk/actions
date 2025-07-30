# Rust Release Actions

Reusable GitHub Actions for cross-platform Rust binary releases with NPM publishing support.

## Features

- 🦀 **Multi-binary Rust builds** - Build multiple binaries (e.g., production + development versions)
- 🌍 **Cross-platform support** - macOS (ARM64), Linux (x64/ARM64), Windows (x64/ARM64)
- 📦 **NPM integration** - Automatic NPM package publishing with TypeScript compilation
- 🔧 **Modular design** - Composite actions + reusable workflow
- ⚡ **Parallel builds** - Matrix-based parallel compilation
- 🎯 **Selective building** - Choose specific platforms and binaries

## Quick Start

### Basic Usage

```yaml
name: Release
on:
  push:
    tags: ['v*']

jobs:
  release:
    uses: ./actions/.github/workflows/rust-release.yml
    with:
      main_binary: my-app
      binaries: 'my-app,my-app-dev'  # Build both production and dev versions
    secrets:
      NPM_TOKEN: ${{ secrets.NPM_TOKEN }}
      GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

### Advanced Usage

```yaml
jobs:
  release:
    uses: ./actions/.github/workflows/rust-release.yml
    with:
      binaries: 'pm,_pm'              # Multiple binaries
      platforms: 'macos-arm64,linux-x64'  # Specific platforms only
      main_binary: pm                 # Main binary for NPM
      npm_enabled: true              # Enable NPM publishing
      npm_directory: npm             # NPM project directory
    secrets:
      NPM_TOKEN: ${{ secrets.NPM_TOKEN }}
      GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

## Components

### Reusable Workflow

**Location**: `.github/workflows/rust-release.yml`

Main orchestration workflow that coordinates the entire release process.

#### Inputs

| Input | Description | Default | Required |
|-------|-------------|---------|----------|
| `binaries` | Comma-separated binary names | `'all'` | No |
| `platforms` | Target platforms to build | `'all'` | No |
| `main_binary` | Main binary name for NPM | - | Yes |
| `npm_enabled` | Enable NPM publishing | `true` | No |
| `npm_directory` | NPM project directory | `'npm'` | No |
| `tag_name` | Release tag name | Auto-detected | No |

#### Secrets

| Secret | Description | Required |
|--------|-------------|----------|
| `NPM_TOKEN` | NPM authentication token | If NPM enabled |
| `GITHUB_TOKEN` | GitHub token for releases | Yes |

### Composite Actions

#### 1. `rust-build`

Builds Rust binaries with cross-compilation support.

```yaml
- uses: ./actions/actions/rust-build
  with:
    target: x86_64-unknown-linux-gnu
    binaries: 'pm,_pm'
    cross_compile: 'false'
```

#### 2. `github-release`

Uploads multiple binary assets to GitHub Release.

```yaml
- uses: ./actions/actions/github-release
  with:
    tag_name: v1.0.0
    built_binaries: ${{ steps.build.outputs.built_binaries }}
    platform: linux
    arch: x64
    token: ${{ secrets.GITHUB_TOKEN }}
```

#### 3. `npm-publish`

Builds and publishes NPM package with TypeScript compilation.

```yaml
- uses: ./actions/actions/npm-publish
  with:
    npm_directory: npm
    version: 1.0.0
    token: ${{ secrets.NPM_TOKEN }}
```

## Platform Support

| Platform | Architecture | Target Triple |
|----------|--------------|---------------|
| macOS | ARM64 | `aarch64-apple-darwin` |
| Linux | x64 | `x86_64-unknown-linux-gnu` |
| Linux | ARM64 | `aarch64-unknown-linux-gnu` |
| Windows | x64 | `x86_64-pc-windows-msvc` |
| Windows | ARM64 | `aarch64-pc-windows-msvc` |

## Examples

### Build All Platforms, Single Binary

```yaml
jobs:
  release:
    uses: ./actions/.github/workflows/rust-release.yml
    with:
      main_binary: my-cli
      binaries: 'my-cli'  # Only production binary
      platforms: 'all'   # All supported platforms
    secrets: inherit
```

### Selective Platform Build

```yaml
jobs:
  release:
    uses: ./actions/.github/workflows/rust-release.yml
    with:
      main_binary: my-cli
      platforms: 'macos-arm64,linux-x64'  # macOS and Linux x64 only
    secrets: inherit
```

### Development vs Production Binaries

```yaml
jobs:
  release:
    uses: ./actions/.github/workflows/rust-release.yml
    with:
      main_binary: my-cli          # Production binary for NPM
      binaries: 'my-cli,my-cli-dev'  # Both prod and dev binaries
      npm_enabled: true            # Publish to NPM (main_binary only)
    secrets: inherit
```

### NPM-only Release (No GitHub Release)

```yaml
jobs:
  npm-only:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: ./actions/actions/npm-publish
        with:
          npm_directory: npm
          version: ${{ github.ref_name }}
          token: ${{ secrets.NPM_TOKEN }}
```

## Project Structure Requirements

### Rust Project

```
your-project/
├── Cargo.toml                    # Main Rust project
├── src/
│   ├── lib.rs                   # Optional library
│   └── bin/
│       ├── my-cli.rs           # Production binary
│       └── my-cli-dev.rs       # Development binary
└── npm/                         # NPM package (optional)
    ├── package.json
    ├── src/
    │   └── cli.ts
    └── scripts/
        └── download-binary.js
```

### Cargo.toml Configuration

```toml
[package]
name = "my-project"
version = "1.0.0"

[[bin]]
name = "my-cli"
path = "src/bin/my-cli.rs"

[[bin]]
name = "my-cli-dev"
path = "src/bin/my-cli-dev.rs"
```

## Workflow Triggers

### Tag-based Release

```yaml
on:
  push:
    tags: ['v*']
```

### Manual Release

```yaml
on:
  workflow_dispatch:
    inputs:
      tag:
        description: 'Release tag'
        required: true
      platforms:
        description: 'Platforms to build'
        default: 'all'
      binaries:
        description: 'Binaries to build'
        default: 'all'
```

## Asset Naming Convention

Generated release assets follow this pattern:

- `{binary-name}-{platform}-{arch}[.exe]`
- Examples:
  - `pm-macos-arm64`
  - `pm-linux-x64`  
  - `pm-windows-x64.exe`
  - `_pm-linux-arm64` (development binary)

## Troubleshooting

### Common Issues

1. **Cross-compilation failures**: Ensure proper toolchain setup in the action
2. **NPM build failures**: Check TypeScript configuration and dependencies
3. **Missing binaries**: Verify binary names match Cargo.toml configuration
4. **Permission errors**: Ensure proper secrets are configured

### Debug Mode

Enable debug logging by setting `ACTIONS_STEP_DEBUG=true` in repository secrets.

## License

MIT License - see the [LICENSE](../LICENSE) file for details.