# 打包资源目录

此目录用于存放 Electron 应用打包所需的图标和资源文件。

## 需要准备的图标文件

### Windows
- `icon.ico` — 256x256 像素（包含多种尺寸：16, 32, 48, 64, 128, 256）

### macOS
- `icon.icns` — 包含多种尺寸的 macOS 图标文件

### Linux
- `icons/` 目录，包含以下尺寸的 PNG 图标：
  - `16x16.png`
  - `32x32.png`
  - `48x48.png`
  - `64x64.png`
  - `128x128.png`
  - `256x256.png`
  - `512x512.png`

## 图标生成工具

### 方法 1：使用在线工具
1. 准备一张 1024x1024 的高清 PNG 图片
2. 使用 [cloudconvert.com](https://cloudconvert.com/png-to-icns) 或 [icoconvert.com](https://icoconvert.com/) 转换格式

### 方法 2：使用 electron-icon-builder（推荐）
```bash
npm install -g electron-icon-builder

# 准备一张 1024x1024 的 icon.png 放在 build/ 目录
electron-icon-builder --input=./build/icon.png --output=./build
```

### 方法 3：使用 ImageMagick
```bash
# Windows (.ico)
magick icon.png -define icon:auto-resize=256,128,64,48,32,16 icon.ico

# Linux (各尺寸 PNG)
magick icon.png -resize 16x16 icons/16x16.png
magick icon.png -resize 32x32 icons/32x32.png
# ... 以此类推
```

## 临时测试（无图标）

如果暂时没有图标，打包仍然可以运行，只是会使用 Electron 默认图标。

# Build

on:
  push:
    tags:
      - 'v*'

jobs:
  build:
    strategy:
      matrix:
        os: [windows-latest, macos-latest, ubuntu-latest]
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: npm ci
      - run: npm run rebuild
      - run: npm run dist
      - uses: actions/upload-artifact@v4
        with:
          name: release-${{ matrix.os }}
          path: release/*
