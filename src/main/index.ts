import { app, shell, BrowserWindow, Menu } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { registerIpcHandlers } from './ipc'

app.setName('sshterm')

const UI_CHANNELS = {
  openSettings: 'ui:openSettings',
  openActiveDeviceSettings: 'ui:openActiveDeviceSettings',
  toggleSidebar: 'ui:toggleSidebar',
  closeActiveTab: 'ui:closeActiveTab'
} as const

function openSettingsFromMenu(): void {
  const focused = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
  if (!focused) return
  focused.webContents.send(UI_CHANNELS.openSettings)
}

function closeActiveTabFromMenu(): void {
  const focused = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
  if (!focused) return
  focused.webContents.send(UI_CHANNELS.closeActiveTab)
}

function setupApplicationMenu(): void {
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: 'sshterm',
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        {
          label: 'Preferences…',
          accelerator: 'CommandOrControl+,',
          click: () => openSettingsFromMenu()
        },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'delete' },
        { role: 'selectAll' }
      ]
    },
    {
      label: 'File',
      submenu: [
        {
          label: 'Close Tab',
          accelerator: 'CommandOrControl+W',
          click: () => closeActiveTabFromMenu()
        }
      ]
    },
    {
      label: 'View',
      submenu: [{ role: 'reload' }, { role: 'forceReload' }, { role: 'toggleDevTools' }]
    },
    {
      label: 'Window',
      submenu: [{ role: 'minimize' }, { role: 'zoom' }, { role: 'front' }]
    }
  ]

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

function createWindow(): void {
  // Create the browser window.
  const mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    title: '',
    show: false,
    autoHideMenuBar: true,
    icon,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  registerIpcHandlers(mainWindow)

  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return

    const isCommandOrControlPressed = process.platform === 'darwin' ? input.meta : input.control
    if (!isCommandOrControlPressed) return

    if (input.key === ',') {
      event.preventDefault()
      if (input.shift) {
        mainWindow.webContents.send(UI_CHANNELS.openActiveDeviceSettings)
      } else {
        mainWindow.webContents.send(UI_CHANNELS.openSettings)
      }
      return
    }

    if (input.key.toLowerCase() === 's') {
      event.preventDefault()
      mainWindow.webContents.send(UI_CHANNELS.toggleSidebar)
      return
    }

    if (input.key.toLowerCase() === 'w') {
      event.preventDefault()
      mainWindow.webContents.send(UI_CHANNELS.closeActiveTab)
    }
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // HMR for renderer base on electron-vite cli.
  // Load the remote URL for development or the local html file for production.
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(() => {
  // Set app user model id for windows
  electronApp.setAppUserModelId('com.sshterm.app')

  if (process.platform === 'darwin' && app.dock) {
    app.dock.setIcon(icon)
  }

  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production.
  // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  setupApplicationMenu()

  createWindow()

  app.on('activate', function () {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and require them here.
