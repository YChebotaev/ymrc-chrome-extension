const RCID = "RCID";

// ---------------------------------------------------------------------------------

const clickOnControl = (className) => {
  const playerControls = document.getElementsByClassName("player-controls")[0];

  playerControls.getElementsByClassName(className)[0].click();
}

// ---------------------------------------------------------------------------------

class HTTPClient {
  constructor({ baseURL }) {
    this.baseURL = baseURL
  }

  get(path, params) {
    const url = new URL(path, this.baseURL)

    for (const [key, value] of Object.entries(params)) {
      url.searchParams.append(key, value)
    }

    return fetch(url)
  }

  post(path, data) {
    const url = new URL(path, this.baseURL)

    return fetch(url, {
      method: 'POST',
      body: JSON.stringify(data, null, 2)
    })
  }
}

// ---------------------------------------------------------------------------------

class Poller {
  constructor({ commandExecutor, pincodeManager, httpClient, since = new Date(), timeout = 1000 }) {
    this.commandExecutor = commandExecutor
    this.pincodeManager = pincodeManager
    this.since = since
    this.timeout = timeout
    this.httpClient = httpClient
    this.t = null
  }

  start() {
    const poll = () => {
      this.poll()

      this.t = setTimeout(poll, this.timeout)
    }

    this.t = setTimeout(poll, this.timeout)
  }

  stop() {
    clearTimeout(this.t)
  }

  async poll() {
    const pincode = await this.pincodeManager.getPincode()
    const resp = await this.httpClient.get(`/players/${pincode}/get_commands`, { since: this.since.getTime() })
    const commands = await resp.json()

    this.since = new Date()

    for (const { method, params } of commands) {
      const methodFn = this.commandExecutor[method]

      if (typeof methodFn === 'function') {
        await methodFn.apply(this.commandExecutor, params)
      }
    }
  }
}

// ---------------------------------------------------------------------------------

class CommandExecutor {
  constructor({ stateUpdater, httpClient }) {
    this.stateUpdater = stateUpdater
    this.httpClient = httpClient
  }

  async play() {
    clickOnControl("player-controls__btn_play")

    await this.stateUpdater.nowPlaying(true)
  }

  async pause() {
    clickOnControl("player-controls__btn_pause")

    await this.stateUpdater.nowPlaying(false)
  }

  forward() {
    clickOnControl("player-controls__btn_next")
  }

  backward() {
    clickOnControl("player-controls__btn_prev")
  }
}

// ---------------------------------------------------------------------------------

class StateUpdater {
  constructor({ httpClient, pincodeManager, timeout = 3000 }) {
    this.timeout = timeout
    this.httpClient = httpClient
    this.pincodeManager = pincodeManager
    this.t = null
  }

  async start() {
    const upd = async () => {
      await this.fullUpdate()

      this.t = setTimeout(upd, this.timeout)
    }

    await upd()
  }

  stop() {
    clearTimeout(this.t)
  }

  async fullUpdate() {
    try {
      const trackNameWrap = document.querySelector('.track__name-wrap')
      const [trackName, authorName] = trackNameWrap?.innerText?.split('\n') ?? []
      const prevName = document.querySelector('.player-controls__btn_prev').title.slice(0, -12)
      const nextName = document.querySelector('.player-controls__btn_next').title.slice(0, -13)
      const hasPauseBtn = document.querySelector('.player-controls__btn_pause') == null

      this.update({
        curr_name: `${trackName} - ${authorName}`,
        next_name: nextName,
        prev_name: prevName,
        curr_volume: null,
        now_playing: hasPauseBtn ? 0 : 1
      })
    } finally {
      // Just suppress any errors
    }
  }

  async update(state) {
    const pincode = await this.pincodeManager.getPincode()

    await this.httpClient.post(`/players/${pincode}/state_update`, state)
  }

  async nowPlaying(state) {
    await this.update({
      now_playing: state ? 1 : 0,
    })
  }
}

// ---------------------------------------------------------------------------------

class PincodeManager {
  symbols = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9']

  constructor(size) {
    this.size = size
  }

  getPincode() {
    return new Promise((resolve, reject) => {
      chrome.storage.sync.get([RCID], ({ [RCID]: value }) => {
        if (value == null) {
          value = this.generatePincode()

          chrome.storage.sync.set({ [RCID]: value })
        }

        resolve(value)
      })
    })
  }

  generatePincode() {
    const { size } = this
    let pincode = ''

    for (let i = 0; i < size; i++) {
      const idx = Math.floor(Math.random() * this.symbols.length)

      pincode += this.symbols[idx]
    }

    return pincode
  }
}

// =================================================================================

const pincodeManager = new PincodeManager(8)
const httpClient = new HTTPClient({
  baseURL: 'https://ymrc-service.ru'
})
const stateUpdater = new StateUpdater({
  pincodeManager,
  httpClient
})
const commandExecutor = new CommandExecutor({
  stateUpdater,
  httpClient
})
const poller = new Poller({
  pincodeManager,
  commandExecutor,
  httpClient
})

poller.start()
stateUpdater.start()

// console.log('chrome.storage', chrome.storage)
// console.log('chrome.runtime', chrome.runtime)
