const mongoose = require('mongoose')

const TweetSchema = new mongoose.Schema({
  tweet: Object
})

const Tweet = mongoose.model('Tweet', TweetSchema)

module.exports = Tweet
