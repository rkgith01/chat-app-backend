const mongoose = require("mongoose")

const MessageSchema = new mongoose.Schema({
    sender: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User"
    },
    to: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User"
    },
    text: {
        type: String,
    },
    file: {
        type: String,
    }

}, {timestamps: true})

const MessageModel = mongoose.model("Message", MessageSchema)

module.exports = MessageModel 