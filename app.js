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
const APP_SECRET = (process.env.MESSENGER_APP_SECRET) ?
  process.env.MESSENGER_APP_SECRET :
  config.get('appSecret')

// Arbitrary value used to validate a webhook
const VALIDATION_TOKEN = (process.env.MESSENGER_VALIDATION_TOKEN) ?
  (process.env.MESSENGER_VALIDATION_TOKEN) :
  config.get('validationToken')

// Generate a page access token for your page from the App Dashboard
const PAGE_ACCESS_TOKEN = (process.env.MESSENGER_PAGE_ACCESS_TOKEN) ?
  (process.env.MESSENGER_PAGE_ACCESS_TOKEN) :
  config.get('pageAccessToken')

// URL where the app is running (include protocol). Used to point to scripts and
// assets located at this address.
const SERVER_URL = (process.env.SERVER_URL) ?
  (process.env.SERVER_URL) :
  config.get('serverURL')

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

app.get('/luituckyew', function (req, res) {
  breakdownTweetsCount = 0
  anyTrainBreakdown = false
  res.json({breakdownTweetsCount: breakdownTweetsCount, anyTrainBreakdown: anyTrainBreakdown})
})

app.get('/setbreakdown', function (req, res) {
  breakdownTweetsCount = 6
  anyTrainBreakdown = true
  res.json({breakdownTweetsCount: breakdownTweetsCount, anyTrainBreakdown: anyTrainBreakdown})
})

app.get('/breakdownTweets', function (req, res) {
  res.json({breakdownTweetsCount: breakdownTweetsCount, anyTrainBreakdown: anyTrainBreakdown})
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
var breakdownTweetsCount = 0

const twitter = new Twit({
  consumer_key: process.env.TWITTER_CONSUMER_KEY,
  consumer_secret: process.env.TWITTER_CONSUMER_SECRET,
  access_token: process.env.TWITTER_ACCESS_TOKEN,
  access_token_secret: process.env.TWITTER_ACCESS_TOKEN_SECRET
})

// setting up a twitter stream
var stream = twitter.stream('statuses/filter', {
  track: 'mrt breakdown,mrt disruption,mrt,nel,northeast line,north east line,ccl,circle line,east west line,east-west line,eastwest line,nsl,north south line,north-south line,downtown line,dtl,ewl,nsl'
// locations: '1.267016, 103.618248, 1.467459, 104.026802'
})

// helper functions
function generateRandomInteger (min, max) {
  return Math.floor(Math.random() * (max - min) + min)
}

function checkIfBreakdown (tweetText) {
  tweetText = tweetText.toLowerCase()
  if (tweetText.match('mrt breakdown|mrt disruption|breakdown|delay|delayed|delays|disruption|train fault|no train service')) {
    breakdownTweetsCount++
    console.log(`${anyTrainBreakdown}: ${tweetText}`)
  }
}

function checkIfServiceResumed (tweetText) {
  tweetText = tweetText.toLowerCase()
  if (tweetText.match('back to normal|resume|resumed')) {
    anyTrainBreakdown = false
    breakdownTweetsCount = 0
  }
}

function checkBreakdownTrend (count) {
  console.log(`CHECKING BREAKDOWN TREND: ${count}`)
  if (count > 3) {
    anyTrainBreakdown = true
    if (broadcasted === false) {
      listOfSenders.forEach(function(id) {
        broadcastBreakdownMessage(id)
      })
      broadcasted = true
    }
  }
}

stream.on('tweet', function (tweet) {
  console.log(`mrt breakdown status(${anyTrainBreakdown} | count: ${breakdownTweetsCount}): ${tweet.text}`)
  checkIfBreakdown(tweet.text)
  checkIfServiceResumed(tweet.text)
  checkBreakdownTrend(breakdownTweetsCount)
})

var swearWordsArray = ['knn', 'cheebye', 'chee bye', 'fuck', 'fuk', 'kannina', 'kan ni na', 'pussy', 'bitch', 'asshole', 'arse']
var swearWordsRegex = new RegExp(swearWordsArray.join('|'), 'i')
var greetingsArray = ['hello', 'hi', 'oh hai', 'hey', 'yo', 'oi', "what's up", 'wassup', 'sup']
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
        sendMRTStatus(senderID, anyTrainBreakdown)
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

// Send MRT status
function sendMRTStatus (recipientId, anyTrainBreakdown) {
  noBreakdownMessages = ['evrythin iz k. trainz r muving juz fine', 'teh trains r werkin jus fine', 'evryting iz ok. hooman ned not shit yo pants', 'no train faultz today. humanz can go 2 wrk']
  breakdownMessages = ['mrt iz as broke as ur human ass.', 'train iz spoiled nao lol.', 'no train 2day 4 hooman.', 'u will b stuck on teh train 4 sum tiem', 'uh oh. itz goin 2 b long ride 4 sum peepurs']
  if (anyTrainBreakdown === false) {
    mrtStatusMessage = noBreakdownMessages[generateRandomInteger(0, noBreakdownMessages.length)]
  } else if (anyTrainBreakdown === true) {
    mrtStatusMessage = breakdownMessages[generateRandomInteger(0, breakdownMessages.length)] + ' Purrrr-lease luk at https://twitter.com/LTAsg 4 moar updates'
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

function broadcastBreakdownMessage (recipientId) {
  var messageData = {
    recipient: {
      id: recipientId
    },
    message: {
      text: 'uh oh, it lookz lyk train haz broken down. Purrrr-lease luk at https://twitter.com/LTAsg 4 moar updates',
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
