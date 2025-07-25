import asyncHandler from "../utils/asyncHandler.js";
import ApiError from "../utils/ApiError.js";
import {User} from "../models/user.model.js";
import ApiResponse from "../utils/ApiResponse.js";
import jwt from "jsonwebtoken";
import uploadOnCloudinary from "../utils/cloudinary.js";
import {deleteCloudinaryImage, deleteLocalFile} from "../utils/deleteImage.js";
import mongoose from "mongoose";


const generateAccessAndRefreshTokens = async (userId) =>{
    try{
        const user = await User.findById(userId)
        const accessToken = user.generateAccessToken()
        const refreshToken = user.generateRefreshToken()

        user.refreshToken = refreshToken
        await user.save({validateBeforeSave: false})

        return {accessToken, refreshToken}
    } catch(error){
        throw new ApiError(500, "Something went wrong while generating token")
    }
}

const registerUser = asyncHandler(async (req,res) =>{
    //get user detail from frontend
    //validate the user data
    //check if user already exists: username and email
    //check for images, check for avatar
    //upload images to cloudinary
    //create user object - create user in database
    //remove password and refresh token field from response
    //check for user creation
    //return response to frontend

    const {fullName, email, username, password} = req.body
    // console.log("email: ", email);
    // console.log(res.body);

    if(
        [fullName, email, username, password].some((field) =>field?.trim() ==="")
    ) {
        throw new ApiError(400, "All fields are required")
    }

    const existedUser = await User.findOne({
        $or: [{ username }, { email }]
    })

    if(existedUser) {
        throw new ApiError(409, "Username or email already exists")
    }

    // console.log("req.files: ", req.files);

    const avatarLocalPath = req.files?.avatar[0]?.path;

    // console.log("avatarLocalPath: ", avatarLocalPath);
    // const coverImageLocalPath = req.files?.coverImage[0]?.path;

    let coverImageLocalPath;
    if(req.files && Array.isArray(req.files.coverImage) && req.files.coverImage.length > 0) {
        coverImageLocalPath = req.files.coverImage[0].path; 
    }

    if(!avatarLocalPath) {
        throw new ApiError(400, "Avatar is required")
    }

    const avatar = await uploadOnCloudinary(avatarLocalPath);
    const coverImage = await uploadOnCloudinary(coverImageLocalPath);

    // console.log("avatar: ", avatar);
    // console.log("avatar.secure_url: ", avatar?.secure_url);
    // console.log("avatar.public_id: ", avatar?.public_id);

    if(!avatar || !avatar.url || !avatar.public_id) {
        throw new ApiError(400, "Avatar file is required")
    }

    const user = await User.create({
        fullName,
        avatar: {
            url: avatar?.url,
            public_id: avatar?.public_id,
        },
        coverImage: {
            url: coverImage?.url || "",
            public_id: coverImage?.public_id || "",
        },
        email,
        password,
        username,
    })

    const createdUSer = await User.findById(user._id).select(
        "-password -refreshToken"
    )

    if(!createdUSer) {
        throw new ApiError(500, "Something went wrong while registering user")
    }

    return res.status(201).json(
        new ApiResponse(200, createdUSer, "User registered successfully")
    )

})  

const loginUser = asyncHandler( async (req,res) =>{
    //get user details from frontend or postman
    //validate the user data : check for not null or undefined
    //check for user in database or already exists
    //if exists then get user details 
    //check for password match
    //access token and refresh token 
    //send cookie

    const {email, username, password} = req.body

    // if([email, username].some((field) => field?.trim() === "")) {
    //     throw new ApiError(400, "All fields are required")
    // }

    // if(!username || !email){
    //     throw new ApiError(400, "Username or email is required")
    // }


    if([email, username].some((field) => field?.trim() === "")){
        throw new ApiError(400, "Email or username is required")
    }

    const user = await User.findOne({
        $or: [ { email }, { username }]
    })

    if(!user){
        throw new ApiError(404, "User not found")
    }

    const isPasswordValid = await user.isPasswordCorrect(password)

    if(!isPasswordValid){
        throw new ApiError(401, "Invalid user credentials")
    }


    const {accessToken, refreshToken} = await generateAccessAndRefreshTokens(user._id)

    const loggedInUser = await User.findById(user._id).select(
        "-password -refreshToken"
    )

    const options = {
        httpOnly: true,
        secure: true,
    }

    return res
    .status(200)
    .cookie("accessToken", accessToken, options)
    .cookie("refreshToken", refreshToken, options)
    .json(
        new ApiResponse(
            200,
            {
                user: loggedInUser, accessToken, refreshToken
            },
            "User logged in successfully"
        )
    )
})

const logoutUser = asyncHandler(async (req,res) =>{
    await User.findByIdAndUpdate(
        req.user._id,
        {
            $unset: {
                refreshToken: 1
            }
        },
        {
            new: true
        }
    )

    const options = {
        httpOnly: true,
        secure: true,
    }

    return res
    .status(200)
    .clearCookie("accessToken", options)
    .clearCookie("refreshToken", options)
    .json(new ApiResponse(200, {}, "User logged out successfully"))
})

const refreshAccessToken = asyncHandler(async (req,res) =>{
    const incomingRefreshToken = req.cookies.refreshToken || req.body.refreshToken

    if(!incomingRefreshToken){
        throw new ApiError(401, "unauthorized request")
    }

    try {
        const decodedToken = jwt.verify(incomingRefreshToken, process.env.REFRESH_TOKEN_SECRET)
    
        const user = await User.findById(decodedToken?._id)
    
        if(!user){
            throw new ApiError(404, "User not found")
        }
    
        if(incomingRefreshToken !== user.refreshToken){
            throw new ApiError(401, "Refresh token is expired or used")
        }
    
        const options ={
            httpOnly: true,
            secure: true,
        }
        const {accessToken, newrefreshToken} = await generateAccessAndRefreshTokens(user._id)
    
        return res
        .status(200)
        .cookie("accessToken", accessToken, options)
        .cookie("refreshToken", newrefreshToken, options)
        .json(
            new ApiResponse(
                200,
                {accessToken, newrefreshToken},
                "Access token refreshed successfully"
            )
        )
    } catch (error) {
        throw new ApiError(401, error?.message || "Invalid refresh token")
    }
})

const changeCurrentPassword = asyncHandler(async (req,res)=>{
    const {oldPassword, newPassword} = req.body

    const user = await User.findById(req.user?._id)
    const isPasswordCorrect = await user.isPasswordCorrect(oldPassword)

    if(!isPasswordCorrect){
        throw new ApiError(400, "Old password is incorrect")
    }

    user.password = newPassword
    await user.save({validateBeforeSave: false})

    return res
    .status(200)
    .json(new ApiResponse(200, {}, "Password changed successfully"))
})

const getCurrentUser = asyncHandler(async (req,res)=>{
    const user = await User.findById(req.user?._id).select(
        "-password -refreshtoken"
    )

    return res
    .status(200)
    .json(new ApiResponse(200, user, "Current user fetched successfully"))
})

const updateAccountDetails = asyncHandler(async (req,res)=>{
    const {fullName, email} = req.body

    if([fullName,email].some((field)=>field?.trim() === "")){
        throw new ApiError(400, "Full name and email are required")
    }

    const user = await User.findById(
        req.user?._id,
        {
            $set: {
                fullName,
                email
            }
        },
        {new: true}
    )
    .select("-password -refreshToken")

    return res
    .status(200)
    .json(new ApiResponse(200, user, "Account details updated successfully"))
})

const updateUserAvatar = asyncHandler(async (req,res)=>{
    const avatarLocalPath = req.file?.path
    if(!avatarLocalPath){
        throw new ApiError(400, "Avatar file is missing")
    }

    const avatar = await uploadOnCloudinary(avatarLocalPath)

    deleteLocalFile(avatarLocalPath);

    if(!avatar?.secure_url || !avatar?.public_id){
        throw new ApiError(400, "Avatar upload error")
    }

    // const user = await User.findByIdAndUpdate(
    //     req.user?._id,
    //     {
    //         $set: {
    //             avatar: avatar.url
    //         }
    //     },
    //     {new: true}
    // ).select("-password -refreshToken")

    const user = await User.findById(req.user?._id);
    if(!user) {
        throw new ApiError(404, "User not found")
    }

    //delete old avatar image from cloudinary
    if(user.avatar?.public_id) {
        await deleteCloudinaryImage(user.avatar.public_id);
    }

    user.avatar = {
        url: avatar.secure_url,
        public_id: avatar.public_id,
    };

    await user.save({validateBeforeSave: false});

    const updatedUser = await User.findById(user._id).select("-password -refreshToken");

    return res
    .status(200)
    .json(new ApiResponse(200, user, "Avatar updated successfully"))
})

const updateUserCoverImage = asyncHandler(async (req,res)=>{
    const coverImageLocalPath = req.file?.path
    if(!coverImageLocalPath){
        throw new ApiError(400, "Cover image file is missing")
    }

    const coverImage = await uploadOnCloudinary(coverImageLocalPath)

    deleteLocalFile(coverImageLocalPath);

    if(!coverImage.secure_url || !coverImage.public_id){
        throw new ApiError(400, "Cover image upload error")
    }

    // const user = await User.findByIdAndUpdate(
    //     req.user?._id,
    //     {
    //         $set: {
    //             coverImage: coverImage.url
    //         }
    //     },
    //     {new: true}
    // ).select("-password -refreshToken")

    const user = await User.findById(req.user?._id);
    if(!user) {
        throw new ApiError(404, "User not found")
    }

    if(user.coverImage?.public_id) {
        await deleteCloudinaryImage(user.coverImage.public_id);
    }

    user.coverImage = {
        url: coverImage.secure_url,
        public_id: coverImage.public_id,
    };

    await user.save({validateBeforeSave: false});

    const updatedUser = await User.findById(user._id).select("-password -refreshToken");

    return res
    .status(200)
    .json(new ApiResponse(200, user, "Cover image updated successfully"))
})

const getUserChannelProfile = asyncHandler(async (req,res)=>{
    const {username} = req.params

    if(!username?.trim()){
        throw new ApiError(400, "Username is missing")
    }

    const channel = await User.aggregate([
        {
            $match: {
                username: username?.toLowerCase()
            }
        },
        // Lookup to get the number of subscribers of a channel, we used *channel* to get it
        {
            $lookup: {
                from: "subscriptions",
                localField: "_id",
                foreignField: "channel",
                as: "subscribers"
            }
        },
        // Lookup to get the number of channels a user is subscribed to
        // we used *suscriber* to get it
        {
            $lookup: {
                from: "subscriptions",
                localField: "_id",
                foreignField: "suscriber",
                as: "subscribedTo"
            }
        },
        {
            $addFields: {
                subscribersCount: {
                    $size: "$subscribers"
                },
                subscribedToCount: {
                    $size: "$subscribedTo"
                },
                isSubscribed: {
                    $cond: {
                        if: {$in: [req.user?._id, "$subscribers.suscriber"]},
                        then: true,
                        else: false
                    }
                }
            }
        },
        {
            $project: {
                fullName: 1,
                username: 1,
                subscribersCount: 1,
                subscribedToCount: 1,
                avatar: 1,
                coverImage: 1,
                email: 1,
            }
        }
    ])

    if(!channel?.length){
        throw new ApiError(404, "Channel not found")
    }

    return res
    .status(200)
    .json(new ApiResponse(200, channel[0], "Channel profile fetched successfully"))
})

const getWatchHistory = asyncHandler(async (req,res)=>{
    const user = await User.aggregate([
        {
            $match: {
                _id: new mongoose.Types.ObjectId(req.user?._id)
            }
        },
        {
            $lookup: {
                from: "videos",
                localField: "watchHistory",
                foreignField: "_id",
                as: "watchHistory",
                pipeline: [
                    {
                        $lookup: {
                            from: "users",
                            localField: "owner",
                            foreignField: "_id",
                            as: "owner",
                            pipeline: [
                                {
                                    $project: {
                                        fullName: 1,
                                        username: 1,
                                        avatar: 1
                                    }
                                }
                            ]
                        }
                    },
                    {
                        $addFields: {
                            owner: {
                                $first: "$owner"
                            }
                        }
                    }
                ]
            }
        }
    ])

    return res
    .status(200)
    .json(new ApiResponse(200, user[0].getWatchHistory, "Watch history fetched successfully"))
})

export {
    registerUser, 
    loginUser,
    logoutUser,
    refreshAccessToken,
    changeCurrentPassword,
    getCurrentUser,
    updateAccountDetails,
    updateUserAvatar,
    updateUserCoverImage,
    getUserChannelProfile,
    getWatchHistory
};