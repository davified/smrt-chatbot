const mongoose = require('mongoose')

const TweetSchema = new mongoose.Schema({
  tweet: String
})

const Tweet = mongoose.model('Tweet', TweetSchema)

module.exports = Tweet
