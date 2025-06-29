import asyncHandler from "../utils/asyncHandler.js";
import ApiError from "../utils/ApiError.js";
import {User} from "../models/user.model.js";
import uploadToCloudinary from "../utils/cloudinary.js";
import ApiResponse from "../utils/ApiResponse.js";

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

const registerUser = asyncHandler(async (req,res) => {
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
    // const coverImageLocalPath = req.files?.coverImage[0]?.path;

    let coverImageLocalPath;
    if(req.files && Array.isArray(req.files.coverImage) && req.files.coverImage.length > 0) {
        coverImageLocalPath = req.files.coverImage[0].path; 
    }

    if(!avatarLocalPath) {
        throw new ApiError(400, "Avatar is required")
    }

    const avatar = await uploadToCloudinary(avatarLocalPath);
    const coverImage = await uploadToCloudinary(coverImageLocalPath);

    if(!avatar) {
        throw new ApiError(400, "Avatar file is required")
    }

    const user = await User.create({
        fullName,
        avatar: avatar.url,
        coverImage: coverImage?.url || "",
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


const loginUser = asyncHandler( async (req,res) => {
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
            }
        )
    )


})

export {registerUser, loginUser};