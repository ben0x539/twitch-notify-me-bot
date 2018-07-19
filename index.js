require('dotenv').config()
const request = require('request-promise')
const TwitchJS = require('twitch-js')
const winston = require('winston')
const _ = require('lodash')
const {
  EVENT_NAME, IFTTT_KEY,
  TWITCH_CODE, TWITCH_NAME, TWITCH_CHANNELS,
  MONITORED_CHANNELS, MONITORED_TERMS,
  LOG_LEVEL,
} = process.env

function splitBySpaces (s) {
  if (s === undefined) {
    return undefined
  }

  if (s === "") {
    return []
  }

  return s.split(/\s+/)
}

let Bot
const monitoredChannels = splitBySpaces(MONITORED_CHANNELS) || [] // array of string channel names (each needs to start with a # eg #ninja)
const fallback = TWITCH_NAME ? [TWITCH_NAME] : []
const monitoredTerms = splitBySpaces(MONITORED_TERMS) || fallback // or any additional terms you care about
const otherChannels = splitBySpaces(TWITCH_CHANNELS) || fallback // array of string channel names to join on connect (each WITHOUT a # eg ninja)
const channels = _.union(monitoredChannels.map(s => s.substr(1)), otherChannels)
const twitchName = TWITCH_NAME || 'justinfan0'

const opts = {
  identity: {
    username: twitchName,
    password: TWITCH_CODE
  },
  channels: channels,
  reconnect: true,
  maxReconnectAttempts: 5
}

const logger = winston.createLogger({
  level: LOG_LEVEL || 'info',
  format:  winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [ new winston.transports.Console() ]
})

logger.info("starting up", {
  channels: channels,
  monitoredChannels: monitoredChannels,
  monitoredTerms: monitoredTerms,
})

if (channels.length == 0) {
  logger.error("channel list missing (set TWITCH_CHANNELS env var)")
  process.exit(1)
}

if (monitoredChannels.length == 0 && monitoredTerms.length == 0) {
  logger.error("not monitoring anything (set MONITORED_CHANNELS or MONITORED_TERMS env vars)")
  process.exit(1)
}

if (TWITCH_NAME && !/^justinfan\d+/.test(TWITCH_NAME) && !TWITCH_CODE) {
  logger.error("twitch auth code missing (set TWITCH_CODE env var)")
  process.exit(1)
}

if (!EVENT_NAME || !IFTTT_KEY) {
  logger.error("ifttt config missing (set EVENT_NAME and IFTTT_KEY env vars)")
  process.exit(1)
}

function onChatHandler (channel, userstate = {}, message, self) {
  if (userstate.username === twitchName) return

  logger.debug("received chat message", {
    channel: channel,
    sender: userstate.username,
    text: message,
  })

  if (isInMonitoredChannel(channel) || includesMonitoredTerm(message)) {
    logger.info("sending notification for chat message", {
      channel: channel,
      sender: userstate.username,
      text: message,
    })
    return sendMessage(message, userstate.username, channel)
  }
}

function runBot () {
  Bot = new TwitchJS.client(opts)

  Bot.on('connected', onConnectedHandler)
  Bot.on('disconnected', onDisconnectedHandler)
  Bot.on('chat', onChatHandler)

  Bot.connect()
}

function onConnectedHandler (addr, port) {
  logger.info("connected to twitch", { endpoint: `${addr}:${port}` })
}

function onDisconnectedHandler (reason) {
  logger.info("disconnected", { reason: reason })
  process.exit(1)
}

function sendMessage (message, sender, channel) {
  const url = `https://maker.ifttt.com/trigger/${EVENT_NAME}/with/key/${IFTTT_KEY}`
  return request(url, {
    body: {
      value1: message,
      value2: sender,
      value3: channel,
    },
    json: true,
    method: 'POST'
  }).catch(e => {
    logger.error("couldn't send ifttt message", { err: e })
  })
}

module.exports = runBot()

function isInMonitoredChannel (channel) {
  const result = monitoredChannels.includes(channel)
  logger.debug("checking if channel is monitored", {
    channel: channel,
    monitored: result,
  })
  return result
}

function includesMonitoredTerm (message) {
  return monitoredTerms.some(function (term) {
    const result = message.includes(term)
    logger.debug("checking if monitored term matches", {
      term: term,
      matches: result,
    })
    return result
  })
}
