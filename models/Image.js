const mongoose = require("mongoose")

const ImageSchema = new mongoose.Schema({
    sender: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User"
    },
    image: {
        type: String,
    }

}, {timestamps: true})

const ImageModel = mongoose.model("image", ImageSchema)

module.exports = ImageModel 