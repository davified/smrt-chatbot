/* jshint node: true, devel: true */
require('newrelic')

const bodyParser = require('body-parser'),
  config = require('config'),
  crypto = require('crypto'),
  express = require('express'),
  https = require('https'),
  request = require('request'),
  mongoose = require('mongoose'),
  Twit = require('twit')
require('dotenv').config()
mongoose.connect(process.env.MONGODB_URI)
const User = require('./models/user')
const Tweet = require('./models/tweet')

var listOfSenders = []
var broadcasted = false

User.find({}, function (err, usersArray) {
  if (err) console.log('mongoDB error. cannot get listOfSenders array')
  Object.keys(usersArray).forEach(function (key) {
    var id = usersArray[key]['id']
    listOfSenders.push(id)
  })
  console.log(listOfSenders)
})

var app = express()
app.set('port', process.env.PORT || 5000)
app.set('view engine', 'ejs')
app.use(bodyParser.json({ verify: verifyRequestSignature }))
app.use(express.static('public'))

// App Secret can be retrieved from the App Dashboard
const APP_SECRET = process.env.MESSENGER_APP_SECRET

// Arbitrary value used to validate a webhook
const VALIDATION_TOKEN = process.env.MESSENGER_VALIDATION_TOKEN

// Generate a page access token for your page from the App Dashboard
const PAGE_ACCESS_TOKEN = process.env.MESSENGER_PAGE_ACCESS_TOKEN

// URL where the app is running (include protocol). Used to point to scripts and
// assets located at this address.
const SERVER_URL = process.env.SERVER_URL

if (!(APP_SECRET && VALIDATION_TOKEN && PAGE_ACCESS_TOKEN && SERVER_URL)) {
  console.error('Missing config values')
  process.exit(1)
}

// setting up webhook
app.get('/webhook', function (req, res) {
  if (req.query['hub.mode'] === 'subscribe' &&
    req.query['hub.verify_token'] === VALIDATION_TOKEN) {
    console.log('Validating webhook')
    res.status(200).send(req.query['lenge'])
  } else {
    console.error('Failed validation. Make sure the validation tokens match.')
    res.sendStatus(403)
  }
})

/* All callbacks for Messenger are POST-ed. */
app.post('/webhook', function (req, res) {
  var data = req.body

  // Make sure this is a page subscription
  if (data.object == 'page') {
    // Iterate over each entry. There may be multiple if batched
    data.entry.forEach(function (pageEntry) {
      var pageID = pageEntry.id
      var timeOfEvent = pageEntry.time

      // Iterate over each messaging event
      pageEntry.messaging.forEach(function (messagingEvent) {
        if (listOfSenders.indexOf(messagingEvent.sender.id) === -1) {
          //
          var user = new User({id: messagingEvent.sender.id})
          user.save((err, user) => {
            if (err) console.log('mongoDB createUser save failed')
            listOfSenders.push(messagingEvent.sender.id)
          })
          var firstTimeSender = true
        } else {
          var firstTimeSender = false
        }

        if (messagingEvent.optin) {
          receivedAuthentication(messagingEvent)
        } else if (messagingEvent.message) {
          receivedMessage(messagingEvent, firstTimeSender)
        } else if (messagingEvent.delivery) {
          receivedDeliveryConfirmation(messagingEvent)
        } else if (messagingEvent.postback) {
          receivedPostback(messagingEvent)
        } else if (messagingEvent.read) {
          receivedMessageRead(messagingEvent)
        } else if (messagingEvent.account_linking) {
          receivedAccountLink(messagingEvent)
        } else {
          console.log('Webhook received unknown messagingEvent: ', messagingEvent)
        }
      })
    })

    // Assume all went well. You must send back a 200, within 20 seconds, to let us know you've successfully received the callback. Otherwise, the request will time out.
    res.sendStatus(200)
  }
})

// function hourlyReset

app.get('/luituckyew', function (req, res) {
  faultyStations = []
  confirmedFaultyStations = [{}]
  anyTrainBreakdown = false
  breakdownTweetsArray = []
  resumeTweetsArray = []
  res.json({confirmedFaultyStations: confirmedFaultyStations, faultyStations: faultyStations, anyTrainBreakdown: anyTrainBreakdown})
})

app.get('/setbreakdown', function (req, res) {
  anyTrainBreakdown = true
  res.json({confirmedFaultyStations: confirmedFaultyStations, faultyStations: faultyStations, anyTrainBreakdown: anyTrainBreakdown})
})

app.get('/breakdownTweets', function (req, res) {
  res.json({confirmedFaultyStations: confirmedFaultyStations, faultyStations: faultyStations, anyTrainBreakdown: anyTrainBreakdown})
})

app.get('/dashboard', function (req, res) {
  res.render('dashboard', {breakdownTweetsArray: breakdownTweetsArray, resumeTweetsArray: resumeTweetsArray})
})

/* Verify that the callback came from Facebook. Using the App Secret from
 * the App Dashboard, we can verify the signature that is sent with each
 * callback in the x-hub-signature field, located in the header.
 */
function verifyRequestSignature (req, res, buf) {
  var signature = req.headers['x-hub-signature']

  if (!signature) {
    // For testing, let's log an error. In production, you should throw an
    // error.
    console.error("Couldn't validate the signature.")
  } else {
    var elements = signature.split('=')
    var method = elements[0]
    var signatureHash = elements[1]

    var expectedHash = crypto.createHmac('sha1', APP_SECRET)
      .update(buf)
      .digest('hex')

    if (signatureHash != expectedHash) {
      throw new Error("Couldn't validate the request signature.")
    }
  }
}

/* Authorization Event
 * The value for 'optin.ref' is defined in the entry point. For the "Send to
 * Messenger" plugin, it is the 'data-ref' field. Read more at
 * https://developers.facebook.com/docs/messenger-platform/webhook-reference/authentication
 *
 */
function receivedAuthentication (event) {
  var senderID = event.sender.id
  var recipientID = event.recipient.id
  var timeOfAuth = event.timestamp

  // The 'ref' field is set in the 'Send to Messenger' plugin, in the 'data-ref'
  // The developer can set this to an arbitrary value to associate the
  // authentication callback with the 'Send to Messenger' click event. This is
  // a way to do account linking when the user clicks the 'Send to Messenger'
  // plugin.
  var passThroughParam = event.optin.ref

  console.log('Received authentication for user %d and page %d with pass ' +
  "through param '%s' at %d", senderID, recipientID, passThroughParam,
    timeOfAuth)

  // When an authentication is received, we'll send a message back to the sender
  // to let them know it was successful.
  sendTextMessage(senderID, 'Authentication successful')
}

/* SETTING UP TWITTER STREAM TO LISTEN FOR MRT BREAKDOWN TRENDS IN TWITTER */

// setting up variables for checking twitter stream for MRT breakdowns
var anyTrainBreakdown = false
var breakdownTweetsArray = []
var resumeTweetsArray = []
var faultyStations = []
var confirmedFaultyStations = [{}]

const twitter = new Twit({
  consumer_key: process.env.TWITTER_CONSUMER_KEY,
  consumer_secret: process.env.TWITTER_CONSUMER_SECRET,
  access_token: process.env.TWITTER_ACCESS_TOKEN,
  access_token_secret: process.env.TWITTER_ACCESS_TOKEN_SECRET
})

// setting up a twitter stream
var stream = twitter.stream('statuses/filter', {
  track: 'mrt,mrt breakdown,nel breakdown,dtl breakdown,ewl breakdown,nsl breakdown,northeast line breakdown,north east line breakdown,ccl breakdown,circle line breakdown,east west line breakdown,east-west line breakdown,eastwest line breakdown,north south line breakdown,north-south line breakdown,downtown line breakdown',
  follow: [68321763]
// locations: '103.6182,1.208323,104.013551,1.472212' //removing locations because Twitter filters tweets by tracked terms || location.
})

// helper functions
function generateRandomInteger (min, max) {
  return Math.floor(Math.random() * (max - min) + min)
}

function checkIfBreakdown (tweet) {
  tweetText = tweet.text.toLowerCase()
  if (tweetText.match('breakdown|disruption|delay|fault|no train service') && !tweetText.match('bangkok|thailand|bkk|busan|djmrt|london|subway|data|singtel|birthday' && tweet.user.id !== 797468706947223552)) {
    breakdownTweetsArray.push(tweetText)
    identifyFaultyStations(tweetText, stationsList)

    var tweet = new Tweet({tweet: tweet})
    tweet.save((err, tweet) => {
      if (err) console.log('mongoDB createTweet save failed')
      console.log('breakdown tweet: ' + tweet);
    })
  }
}

function checkIfServiceResumed (tweet) {
  tweetText = tweet.text.toLowerCase()
  isLTA = tweet.user.id === 68321763 // LTA twitter user id

  if (isLTA && tweetText.match('back to normal|resume|resumed')) {
    anyTrainBreakdown = false
    confirmedFaultyStations = [{}]
    faultyStations = []
    broadcasted = false
    resumeTweetsArray.push(tweetText)
  }
}

function addStationIfNoneExists(array, stationObject) {
  var isNewFaultyStation = true
  for (var i = 0; i < array.length; i++) {
    if (array[i].station === stationObject.station) {
      isNewFaultyStation = false
    }
  }

  if (isNewFaultyStation) {
    array.push(stationObject)
  }
}

function checkBreakdownTrend (arr) {
  for (var i = 0; i < arr.length; i++) {
    if (arr[i].count > 2) {
      addStationIfNoneExists(confirmedFaultyStations, arr[i])
      anyTrainBreakdown = true
    }
  }

  if (broadcasted === false) {
    // listOfSenders.forEach(function(id) {
    //   broadcastBreakdownMessage(id)
    // })
    broadcastBreakdownMessage(1147915141971758, faultyStations)  // broadcast to myself (david)
    broadcasted = true
  }
}

var stationsList = [/jurong east/, /bukit batok/, /bukit gombak/, /choa chu kang/, /yew tee/, /kranji/, /marsiling/, /woodlands/, /admiralty/, /sembawang/, /canberra/, /yishun/, /khatib/, /yio chu kang/, /ang mo kio/, /bishan/, /braddell/, /toa payoh/, /novena/, /newton/, /orchard/, /somerset/, /marina bay/, /marina south pier/, /pasir ris/, /tampines/, /simei/, /tanah merah/, /bedok/, /kembangan/, /eunos/, /paya lebar/, /aljunied/, /kallang/, /lavender/, /bugis/, /city hall/, /raffles place/, /tanjong pagar/, /outram park/, /tiong bahru/, /redhill/, /queenstown/, /commonwealth/, /buona vista/, /dover/, /clementi/, /chinese garden/, /lakeside/, /boon lay/, /pioneer/, /joo koon/, /expo/, /changi airport/, /harbourfront/, /chinatown/, /clarke quay/, /dhoby ghaut/, /little india/, /farrer park/, /boon keng/, /potong pasir/, /woodleigh/, /serangoon/, /kovan/, /hougang/, /buangkok/, /sengkang/, /punggol/, /bras basah/, /esplanade/, /promenade/, /nicoll highway/, /stadium/, /mountbatten/, /dakota/, /macpherson/, /tai seng/, /bartley/, /lorong chuan/, /marymount/, /caldecott/, /bukit brown/, /botanic gardens/, /farrer road/, /holland village/, /one-north/, /kent ridge/, /haw par villa/, /pasir panjang/, /labrador park/, /telok blangah/, /keppel/, /bayfront/, /bukit panjang/, /cashew/, /hillview/, /beauty world/, /king albert park/, /sixth avenue/, /tan kah kee/, /stevens/, /rochor/, /downtown/, /telok ayer/]

// can consider including the following words to catch hashtags. potential downside: they will be counted as a separate object as their long-form version (i.e. jookoon !== joo koon)
// /jurongeast/, /bukitbatok/, /bukitgombak/, /choachukang/, /cck/, /yewtee/, /yiochukang/, /yck/, /angmokio/, /amk/, /toapayoh/, /marinabay/, /marinasouthpier/, /pasirris/, /tanahmerah/, /payalebar/, /cityhall/, /rafflesplace/, /tanjongpagar/, /outrampark/, /tiongbahru/, /buonavista/, /chinesegarden/, /boonlay/, /jookoon/, /changiairport/, /clarkequay/, /dhobyghaut/, /littleindia/, /farrerpark/, /boonkeng/, /potongpasir/, /brasbasah/, /nicollhighway/, /taiseng/, /lorongchuan/, /bukitbrown/, /botanicgardens/, /farrerroad/, /hollandvillage/, /onenorth/, /kentridge/, /hawparvilla/, /pasirpanjang/, /labradorpark/, /telokblangah/, /bukitpanjang/, /beautyworld/, /kingalbertpark/, /sixthavenue/, /tankahkee/, /telok ayer/

function incrementStationCountOrAdd(arr, station) {
  var newBreakdownStation = false;

  for (var i = 0; i < arr.length; i++) {
    if (arr[i].station === station) {
      arr[i].count++
      return true
    }
  }
  newBreakdownStation = true;

  if (newBreakdownStation) {
    arr.push({ station: station, count: 1 });
  }
}

function identifyFaultyStations (string, expressions) {
  var lowercaseString = string.toLowerCase()
  var len = expressions.length

  for (i = 0; i < len; i++) {
    var temp = lowercaseString.match(expressions[i])
    if (temp) {
      incrementStationCountOrAdd(faultyStations, temp[0])
    }
  }
}

stream.on('tweet', function (tweet) {
  checkIfBreakdown(tweet)
  checkIfServiceResumed(tweet)
  checkBreakdownTrend(faultyStations)
})

var swearWordsArray = ['knn', 'cheebye', 'chee bye', 'fuck', 'fuk', 'kannina', 'kan ni na', 'pussy', 'bitch', 'asshole', 'arse']
var swearWordsRegex = new RegExp(swearWordsArray.join('|'), 'i')
var greetingsArray = ['hello', 'hi', 'oh hai', 'hey', "what's up", 'wassup', 'sup']
var greetingsRegex = new RegExp(greetingsArray.join('|'), 'i')
var mrtStatusArray = ['mrt', 'status', 'any breakdown', 'train', 'breakdown']
var mrtStatusRegex = new RegExp(mrtStatusArray.join('|'), 'i')
var gratitudeArray = ['thank', 'thanks', 'thank you', 'thanx', 'xie xie', 'tanq']
var gratitudeRegex = new RegExp(gratitudeArray.join('|'), 'i')

function categorizeMessage (message) {
  if (swearWordsRegex.test(message)) { // Contains the accepted word
    return 'swear word'
  } else if (greetingsRegex.test(message)) {
    return 'greetings'
  } else if (mrtStatusRegex.test(message)) {
    return 'mrt status check'
  } else if (message.slice(-1) === '?') {
    return 'question'
  } else if (gratitudeRegex.test(message)) {
    return 'thank you'
  } else {
    return 'not sure'
  }
}

/* Message Event
 * This event is called when a message is sent to your page. The 'message'
 * object format can vary depending on the kind of message that was received.
*/
function receivedMessage (event, firstTimeSender) {
  var senderID = event.sender.id
  var recipientID = event.recipient.id
  var timeOfMessage = event.timestamp
  var message = event.message

  console.log('Received message for user %d and page %d at %d with message:',
    senderID, recipientID, timeOfMessage)
  console.log(JSON.stringify(message))

  var isEcho = message.is_echo
  var messageId = message.mid
  var appId = message.app_id
  var metadata = message.metadata

  // You may get a text or attachment but not both
  var messageText = message.text
  var messageAttachments = message.attachments
  var quickReply = message.quick_reply

  if (isEcho) {
    // Just logging message echoes to console
    console.log('Received echo for message %s and app %d with metadata %s',
      messageId, appId, metadata)
    return
  } else if (quickReply) {
    var quickReplyPayload = quickReply.payload
    console.log('Quick reply for message %s with payload %s',
      messageId, quickReplyPayload)

    sendTextMessage(senderID, 'Quick reply tapped')
    return
  }

  if (messageText) {
    // If we receive a text message, check to see if it matches any special
    // keywords and send back the corresponding example. Otherwise, just echo
    // the text we received.
    messageCategory = categorizeMessage(messageText)
    switch (messageCategory) {
      case 'greetings':
        if (firstTimeSender === true) {
          sendFirstPrompt(senderID)
          sendSecondPrompt(senderID)
          sendThirdPrompt(senderID)
        } else {
          sendGreetingsResponse(senderID)
        }
        break

      case 'swear word':
        sendSwearWordResponse(senderID)
        break

      case 'not sure':
        sendButtonMessage(senderID)
        break

      case 'mrt status check':
        sendMRTStatus(senderID, anyTrainBreakdown, faultyStations)
        break

      case 'question':
        sendQuestionResponse(senderID)
        sendButtonMessage(senderID)
        break

      case 'thank you':
        sendThankYouReply(senderID)
        break

      default:
        sendButtonMessage(senderID)
    }
  } else if (messageAttachments) {
    sendTextMessage(senderID, 'sry human cat. mrt cat can onli read werds')
  }
}

/*
 * Delivery Confirmation Event
 *
 * This event is sent to confirm the delivery of a message. Read more about
 * these fields at https://developers.facebook.com/docs/messenger-platform/webhook-reference/message-delivered
 *
 */
function receivedDeliveryConfirmation (event) {
  var senderID = event.sender.id
  var recipientID = event.recipient.id
  var delivery = event.delivery
  var messageIDs = delivery.mids
  var watermark = delivery.watermark
  var sequenceNumber = delivery.seq

  if (messageIDs) {
    messageIDs.forEach(function (messageID) {
      console.log('Received delivery confirmation for message ID: %s',
        messageID)
    })
  }

  console.log('All message before %d were delivered.', watermark)
}

/*
 * Postback Event
 *
 * This event is called when a postback is tapped on a Structured Message.
 * https://developers.facebook.com/docs/messenger-platform/webhook-reference/postback-received
 *
 */
function receivedPostback (event) {
  var senderID = event.sender.id
  var recipientID = event.recipient.id
  var timeOfPostback = event.timestamp

  // The 'payload' param is a developer-defined field which is set in a postback
  // button for Structured Messages.
  var payload = event.postback.payload

  console.log("Received postback for user %d and page %d with payload '%s' " +
    'at %d', senderID, recipientID, payload, timeOfPostback)

  if (payload === 'mrt_status_check_payload') {
    sendMRTStatus(senderID, anyTrainBreakdown)
  } else if (payload === 'show_gif_payload') {
    sendGifMessage(senderID)
    if (generateRandomInteger(0, 4) === 1) {
      sendGifWarning(senderID)
    }
  } else if (payload === 'show_image_payload') {
    sendImageMessage(senderID)
  }
}

/*
 * Message Read Event
 *
 * This event is called when a previously-sent message has been read.
 * https://developers.facebook.com/docs/messenger-platform/webhook-reference/message-read
 *
 */
function receivedMessageRead (event) {
  var senderID = event.sender.id
  var recipientID = event.recipient.id

  // All messages before watermark (a timestamp) or sequence have been seen.
  var watermark = event.read.watermark
  var sequenceNumber = event.read.seq

  console.log('Received message read event for watermark %d and sequence ' +
    'number %d', watermark, sequenceNumber)
}

/* Account Link Event
 * This event is called when the Link Account or UnLink Account action has been
 * tapped.
 * https://developers.facebook.com/docs/messenger-platform/webhook-reference/account-linking
 *
 */
function receivedAccountLink (event) {
  var senderID = event.sender.id
  var recipientID = event.recipient.id

  var status = event.account_linking.status
  var authCode = event.account_linking.authorization_code

  console.log('Received account link event with for user %d with status %s ' +
    'and auth code %s ', senderID, status, authCode)
}

function parseFaultyStations(stations) {
  var msg = " thar appearz 2 b delays ard "
  for (var i = stations.length - 1; i > 0 ; i--) {
    if (i > 1) {
      msg += stations[i].station + ", ";
    } else if (i === 1) {
      msg += stations[i].station + " n ";
    } else {
      msg += stations[i].station + ". ";
    }
  }
  return msg
}
// Send MRT status
function sendMRTStatus (recipientId, anyTrainBreakdown, faultyStations) {
  noBreakdownMessages = ['evrythin iz k. trainz r muving juz fine', 'teh trains r werkin jus fine', 'evryting iz ok. big cat iz lucky 2day lol', 'no train faultz today. humanz can go 2 wrk']
  breakdownMessages = ['mrt iz as broke as ur human ass.', 'train iz spoiled nao lol.', 'no train 2day 4 hooman.', 'u will b stuck on teh train 4 sum tiem', 'uh oh. itz goin 2 b long ride 4 sum peepurs']
  if (anyTrainBreakdown === false) {
    mrtStatusMessage = noBreakdownMessages[generateRandomInteger(0, noBreakdownMessages.length)]
  } else if (anyTrainBreakdown === true) {
    if (faultyStations.length !== 0) {
      mrtStatusMessage = breakdownMessages[generateRandomInteger(0, breakdownMessages.length)] + parseFaultyStations(confirmedFaultyStations) + ' Purrrr-lease luk at https://twitter.com/LTAsg 4 moar updates'
    } else {
      mrtStatusMessage = breakdownMessages[generateRandomInteger(0, breakdownMessages.length)] + ' Purrrr-lease luk at https://twitter.com/LTAsg 4 moar updates'
    }
  }

  var messageData = {
    recipient: {
      id: recipientId
    },
    message: {
      text: mrtStatusMessage,
      metadata: 'DEVELOPER_DEFINED_METADATA'
    }
  }

  callSendAPI(messageData)
}

function sendSwearWordResponse (recipientId) {
  swearWordsResponseArray = ['Y is u so naughty?', 'earfling cat shud not b so rude', 'U is messing wid da wrong cat.', 'u shud stap swearing', 'swearing iz no gud 4 humans']

  var messageData = {
    recipient: {
      id: recipientId
    },
    message: {
      text: swearWordsResponseArray[generateRandomInteger(0, swearWordsResponseArray.length)],
      metadata: 'DEVELOPER_DEFINED_METADATA'
    }
  }

  callSendAPI(messageData)
}

function broadcastBreakdownMessage (recipientId, faultyStations) {
  msg = 'uh oh, it lookz lyk train haz broken down. Purrrr-lease luk at https://twitter.com/LTAsg 4 moar updates'
  if (faultyStations.length !== 0) {
    msg = 'uh oh, it lookz lyk train haz broken down.' + parseFaultyStations(confirmedFaultyStations) + 'Purrrr-lease luk at https://twitter.com/LTAsg 4 moar updates'
  }
  var messageData = {
    recipient: {
      id: recipientId
    },
    message: {
      text: msg,
      metadata: 'DEVELOPER_DEFINED_METADATA'
    }
  }
  callSendAPI(messageData)
}

function sendFirstPrompt (recipientId) {
  var messageData = {
    recipient: {
      id: recipientId
    },
    message: {
      text: 'i m mrt cat',
      metadata: 'DEVELOPER_DEFINED_METADATA'
    }
  }
  callSendAPI(messageData)
}

function sendSecondPrompt (recipientId) {
  var messageData = {
    recipient: {
      id: recipientId
    },
    message: {
      text: 'i liv in da tunnels n i noe if thar r train breakdownz',
      metadata: 'DEVELOPER_DEFINED_METADATA'
    }
  }
  callSendAPI(messageData)
}

function sendThirdPrompt (recipientId) {
  var messageData = {
    recipient: {
      id: recipientId
    },
    message: {
      text: 'u can type "mrt status" or type ANYTHIN u wan',
      metadata: 'DEVELOPER_DEFINED_METADATA'
    }
  }
  callSendAPI(messageData)
}

function sendGifWarning (recipientId) {
  var messageData = {
    recipient: {
      id: recipientId
    },
    message: {
      text: 'meow. b careful. muvin catz r as beeeg as 1 megabite n data charges nt cheap 4 mancat',
      metadata: 'DEVELOPER_DEFINED_METADATA'
    }
  }
  callSendAPI(messageData)
}

function sendGreetingsResponse (recipientId) {
  greetingsArray = ['oh hai again', 'oh hai human', 'helloz human', 'harrow man cat', 'greetingz earfling', 'do you haz questshuns 4 me?']
  var messageData = {
    recipient: {
      id: recipientId
    },
    message: {
      text: greetingsArray[generateRandomInteger(0, greetingsArray.length)],
      metadata: 'DEVELOPER_DEFINED_METADATA'
    }
  }
  callSendAPI(messageData)
}

function sendQuestionResponse (recipientId) {
  var messageData = {
    recipient: {
      id: recipientId
    },
    message: {
      text: 'me me no undrstnd yo questshion',
      metadata: 'DEVELOPER_DEFINED_METADATA'
    }
  }
  callSendAPI(messageData)
}

function sendThankYouReply (recipientId) {
  thankYouRepliesArray = ['u r welcom. can i has cheezburger?', 'doan menshun it', 'ur meowcome']
  var messageData = {
    recipient: {
      id: recipientId
    },
    message: {
      text: thankYouRepliesArray[generateRandomInteger(0, thankYouRepliesArray.length)],
      metadata: 'DEVELOPER_DEFINED_METADATA'
    }
  }
  callSendAPI(messageData)
}

/*
 * Send an image using the Send API.
 *
 */
function sendImageMessage (recipientId) {
  var messageData = {
    recipient: {
      id: recipientId
    },
    message: {
      attachment: {
        type: 'image',
        payload: {
          url: 'http://thecatapi.com/api/images/get?api_key=MTM0MjUw'
        }
      }
    }
  }

  callSendAPI(messageData)
}

/*
 * Send a Gif using the Send API.
 *
 */
function sendGifMessage (recipientId) {
  var messageData = {
    recipient: {
      id: recipientId
    },
    message: {
      attachment: {
        type: 'image',
        payload: {
          // replace with giphy API url
          url: 'http://thecatapi.com/api/images/get?api_key=MTM0MjUw&format=src&type=gif'
        }
      }
    }
  }

  callSendAPI(messageData)
}

/*
 * Send a text message using the Send API.
 *
 */
function sendTextMessage (recipientId, messageText) {
  var messageData = {
    recipient: {
      id: recipientId
    },
    message: {
      text: messageText,
      metadata: 'DEVELOPER_DEFINED_METADATA'
    }
  }

  callSendAPI(messageData)
}

/*
 * Send a button message using the Send API.
 *
 */
function sendButtonMessage (recipientId) {
  var messageData = {
    recipient: {
      id: recipientId
    },
    message: {
      attachment: {
        type: 'template',
        payload: {
          template_type: 'button',
          text: 'wut does human wantz to knoe? click wan ov teh opshuns below',
          buttons: [{
            type: 'postback',
            title: 'iz train broke nao?',
            payload: 'mrt_status_check_payload'
          }, {
            type: 'postback',
            title: 'show me yur peepurs!',
            payload: 'show_image_payload'
          }, {
            type: 'postback',
            title: 'muv me wif ur gifs',
            payload: 'show_gif_payload'
          }]
        }
      }
    }
  }

  callSendAPI(messageData)
}

/* Send a message with Quick Reply buttons. */
function sendQuickReply (recipientId) {
  var messageData = {
    recipient: {
      id: recipientId
    },
    message: {
      text: 'wat does chief human wantz to noe?',
      quick_replies: [
        {
          'content_type': 'postback',
          'title': 'Iz MRT brokez now?',
          'payload': 'mrt_status_check_payload'
        },
        {
          'content_type': 'postback',
          'title': 'Show me yur peepurs!',
          'payload': 'show_image_payload'
        },
        {
          'content_type': 'postback',
          'title': 'Muv me with ur gifs',
          'payload': 'show_gif_payload'
        }
      ]
    }
  }

  callSendAPI(messageData)
}

/*
 * Send a read receipt to indicate the message has been read
 *
 */
function sendReadReceipt (recipientId) {
  console.log('Sending a read receipt to mark message as seen')

  var messageData = {
    recipient: {
      id: recipientId
    },
    sender_action: 'mark_seen'
  }

  callSendAPI(messageData)
}

/*
 * Send a message with the account linking call-to-action
 *
 */
function sendAccountLinking (recipientId) {
  var messageData = {
    recipient: {
      id: recipientId
    },
    message: {
      attachment: {
        type: 'template',
        payload: {
          template_type: 'button',
          text: 'Welcome. Link your account.',
          buttons: [{
            type: 'account_link',
            url: SERVER_URL + '/authorize'
          }]
        }
      }
    }
  }

  callSendAPI(messageData)
}

/* Call the Send API. The message data goes in the body. If successful, we'll get the message id in a response */
function callSendAPI (messageData) {
  request({
    uri: 'https://graph.facebook.com/v2.6/me/messages',
    qs: { access_token: PAGE_ACCESS_TOKEN },
    method: 'POST',
    json: messageData

  }, function (error, response, body) {
    if (!error && response.statusCode == 200) {
      var recipientId = body.recipient_id
      var messageId = body.message_id

      if (messageId) {
        console.log('Successfully sent message with id %s to recipient %s',
          messageId, recipientId)
      } else {
        console.log('Successfully called Send API for recipient %s',
          recipientId)
      }
    } else {
      console.error('Failed calling Send API', response.statusCode, response.statusMessage, body.error)
    }
  })
}

// Start server
app.listen(app.get('port'), function () {
  console.log('Node app is running on port', app.get('port'))
})

module.exports = app
