const express = require('express')
const app = express()
require('dotenv').config()
const nodemailer = require("nodemailer");
const cors = require('cors')
const cookieParser = require('cookie-parser')
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb')
const jwt = require('jsonwebtoken')
const stripe = require('stripe')(process.env.STRIPE_TOKEN_SECRET)
const port = process.env.PORT || 5000



// middleware
const corsOptions = {
  origin: ['http://localhost:5173', 'http://localhost:5174'],
  credentials: true,
  optionSuccessStatus: 200,
}
app.use(cors(corsOptions))

app.use(express.json())
app.use(cookieParser())

// send email ----------------------------------------
const sendEmail = (emailAddress, emailData) => {
  const transporter = nodemailer.createTransport({
    service: 'gmail',
    host: 'smtp.gmail.com',
    port: 587,
    secure: false, // Use `true` for port 465, `false` for all other ports
    auth: {
      user: process.env.TRANSPORTER_EMAIL,
      pass: process.env.TRANSPORTER_PASS,
    },
  })

  // verify transporter -----------------------------
  // verify connection configuration
  transporter.verify(function (error, success) {
    if (error) {
      console.log(error)
    } else {
      console.log('Server is ready to take our messages')
    }
  })
  const mailBody = {
    from: `"StayVista" <${process.env.TRANSPORTER_EMAIL}>`, // sender address
    to: emailAddress, // list of receivers
    subject: emailData.subject, // Subject line
    html: emailData.message, // html body
  }

  transporter.sendMail(mailBody, (error, info) => {
    if (error) {
      console.log(error)
    } else {
      console.log('Email Sent: ' + info.response)
    }
  })
}




// Verify Token Middleware ------------
const verifyToken = async (req, res, next) => {
  const token = req.cookies?.token
  console.log(token)
  if (!token) {
    return res.status(401).send({ message: 'unauthorized access' })
  }
  jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, decoded) => {
    if (err) {
      console.log(err)
      return res.status(401).send({ message: 'unauthorized access' })
    }
    req.user = decoded
    next()
  })
}



const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.yy3zscc.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;


const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
})

async function run() {
  try {
    // auth related api
    const roomCollection = client.db('stayVista').collection('rooms')
    const userCollection = client.db('stayVista').collection('users')
    const bookingsCollection = client.db('stayVista').collection('bookings')

    // verify admin middleware ------------------------------

    const verifyAdmin = async (req, res, next) => {
      const user = req.user;
      const query = {email : user?.email}
      const result = await userCollection.findOne(query)
      if(!result || result?.role !== 'admin') return res.status(401).send({message : 'unauthorized access'})
      next()
    }

    // verify host middleware ------------------------------
    const verifyHost = async (req, res, next) => {
      const user = req.user;
      const query = {email : user?.email}
      const result = await userCollection.findOne(query)
      if(!result || result?.role !== 'host'){
        return res.status(401).send({message : 'unauthorized access'})
      }
      next()
    }
 
    // auth related api  --------------
    app.post('/jwt', async (req, res) => {
      const user = req.body
      const token = jwt.sign(user, process.env.ACCESS_TOKEN_SECRET, {
        expiresIn: '365d',
      })
      res
        .cookie('token', token, {
          httpOnly: true,
          secure: process.env.NODE_ENV === 'production',
          sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'strict',
        })
        .send({ success: true })
    })
    // Logout
    app.get('/logout', async (req, res) => {
      try {
        res
          .clearCookie('token', {
            maxAge: 0,
            secure: process.env.NODE_ENV === 'production',
            sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'strict',
          })
          .send({ success: true })
        console.log('Logout successful')
      } catch (err) {
        res.status(500).send(err)
      }
    })

  // create-payment-intent ------------------------------------
    app.post('/create-payment-intent', verifyToken, async (req, res) => {
      const price = req.body.price
      const priceInCent = parseFloat(price) * 100
      if (!price || priceInCent < 1) return
      // generate clientSecret
      const { client_secret } = await stripe.paymentIntents.create({
        amount: priceInCent,
        currency: 'usd',
        // In the latest version of the API, specifying the `automatic_payment_methods` parameter is optional because Stripe enables its functionality by default.
        automatic_payment_methods: {
          enabled: true,
        },
      })
      // send client secret as response
      res.send({ clientSecret: client_secret })
    })


    // save a user in db  ------------------------------
    app.put('/user', async(req, res)=>{
      const user = req.body;

      // check if user in already in db ---
      const query = {email : user?.email}

      const isExits = await userCollection.findOne(query)
      if(isExits){

        if(user.status === 'Requested'){
          const result = await userCollection.updateOne(query, {$set : {status : user?.status}}) 
          return res.send(result)
        }else{
           return res.send(isExits)
        }
      }
      const options = { upsert : true }
      const updateDoc = {
        $set : {
          ...user,
          timestamp : Date.now(),
        }
      }
      const result = await userCollection.updateOne(query, updateDoc, options)
      // send email new user -------------------------------
      sendEmail(user?.email, {
        subject: 'Welcome to Stayvista!',
        message: `Hope you will find you destination`,
      })
      res.send(result)
    })


    // get all user from db --------------------------
    app.get('/users', verifyToken, verifyAdmin, async(req,res)=>{
      const result = await userCollection.find().toArray()
      res.send(result)
    })

     // get user based on email from db --------------------------
    app.get('/users/:email', async(req,res)=>{
      const email = req.params.email;
      const result = await userCollection.findOne({email})
      res.send(result)
    })

    // update user role ------------------------------------------

    app.patch('/user/update/:email', async(req, res)=> {
       const email = req.params.email;
       const user = req.body;
       const query = {email}
       const updateDoc = {
        $set : {
          ...user, timestamp : Date.now()
        } 
       }
      const result = await userCollection.updateOne(query, updateDoc)
      res.send(result) 
    })

  
    // rooms api --------------------------
    app.get('/rooms', async(req, res)=> {
      const category = req.query.category;
      let query = {}
      if(category && category !== 'null') {
        query = {category : category}
      }
      const result = await roomCollection.find(query).toArray();
      res.send(result)
    })

    app.get('/rooms/:id', async(req, res)=> {
      const id = req.params.id;
      const query = {_id : new ObjectId(id)}
      const result = await roomCollection.findOne(query)
      res.send(result)
    })

    // save a room in db ----------------
    app.post('/room', verifyToken, verifyHost, async(req, res)=>{
      const roomData = req.body;
      const result = await roomCollection.insertOne(roomData)
      res.send(result)
    })

    
   // delete room for host --------
    app.delete('/room/:id', verifyToken, verifyHost,  async(req, res)=> {
      const id = req.params.id;
      const query = {_id : new ObjectId(id)}
      const result = await roomCollection.deleteOne(query);
      res.send(result)
    })


    // Save a booking data in db
    app.post('/booking', verifyToken, async (req, res) => {
      const bookingData = req.body
      // save room booking info
      const result = await bookingsCollection.insertOne(bookingData)
     
      // send email to guest ---------------
      sendEmail(bookingData?.guest?.email, {
        subject: 'Booking Successful!',
        message: `You've successfully booked a room through StayVista. Transaction Id: ${bookingData.transactionId}`,
      })
      // send email to host
      sendEmail(bookingData?.host?.email, {
        subject: 'Your room got booked!',
        message: `Get ready to welcome ${bookingData.guest?.name}.`,
      })
      res.send(result)
    })


  // booking  with out email---------------------------------------
    // app.post('/booking', verifyToken, async (req, res) => {
    //   const bookingData = req.body
    //   // save room booking info
    //   const result = await bookingsCollection.insertOne(bookingData)
    //   res.send(result)
    // })



    // update room data --------------------------------------------------
    app.put('/room/update/:id', verifyToken, verifyHost, async (req, res) => {
      const id = req.params.id
      const roomData = req.body
      const query = { _id: new ObjectId(id) }
      const updateDoc = {
        $set: roomData,
      }
      const result = await roomCollection.updateOne(query, updateDoc)
      res.send(result)
    })


    // update Room Status -------------------------------------
    app.patch('/room/status/:id', async (req, res) => {
      const id = req.params.id
      const status = req.body?.status
      // change room availability status
      const query = { _id: new ObjectId(id) }

      const updateDoc = {
        $set: { booked: status },
      }
      const result = await roomCollection.updateOne(query, updateDoc)
      res.send(result)
    })


    // get all booking for a guest ---------------
    app.get('/my-bookings/:email', verifyToken, async (req, res) => {
      const email = req.params.email
      const query = { 'guest.email': email }
      const result = await bookingsCollection.find(query).toArray()
      res.send(result)
    })

       // get all booking for a host
    app.get( '/manage-bookings/:email', verifyToken, verifyHost, async (req, res) => {
        const email = req.params.email
        const query = { 'host.email': email }
        const result = await bookingsCollection.find(query).toArray()
        res.send(result)
      }
    )


  // delete a booking -----------------------------
    app.delete('/booking/:id', verifyToken, async (req, res) => {
      const id = req.params.id
      const query = { _id: new ObjectId(id) }
      const result = await bookingsCollection.deleteOne(query)
      res.send(result)
    })


    // Admin Statistics
    app.get('/admin-stat', verifyToken, verifyAdmin,  async (req, res) => {
      const bookingDetails = await bookingsCollection
        .find(
          {},
          {
            projection: {
              date: 1,
              price: 1,
            },
          }
        )
        .toArray()

      const totalUsers = await userCollection.countDocuments()
      const totalRooms = await roomCollection.countDocuments()
      const totalPrice = bookingDetails.reduce(
        (sum, booking) => sum + booking.price,
        0
      )
      // const data = [
      //   ['Day', 'Sales'],
      //   ['9/5', 1000],
      //   ['10/2', 1170],
      //   ['11/1', 660],
      //   ['12/11', 1030],
      // ]
      const chartData = bookingDetails.map(booking => {
        const day = new Date(booking.date).getDate()
        const month = new Date(booking.date).getMonth() + 1
        const data = [`${day}/${month}`, booking?.price]
        return data
      })
      chartData.unshift(['Day', 'Sales'])
      // chartData.splice(0, 0, ['Day', 'Sales'])

      console.log(chartData)

      console.log(bookingDetails)
      res.send({
        totalUsers,
        totalRooms,
        totalBookings: bookingDetails.length,
        totalPrice,
        chartData,
      })
    })
    

     // Host Statistics ---------------------
    app.get('/host-stat', verifyToken, verifyHost, async (req, res) => {
      const { email } = req.user
      const bookingDetails = await bookingsCollection
        .find(
          { 'host.email': email },
          {
            projection: {
              date: 1,
              price: 1,
            },
          }
        )
        .toArray()

      const totalRooms = await roomCollection.countDocuments({
        'host.email': email,
      })
      const totalPrice = bookingDetails.reduce(
        (sum, booking) => sum + booking.price,
        0
      )
      const { timestamp } = await userCollection.findOne(
        { email },
        { projection: { timestamp: 1 } }
      )

      const chartData = bookingDetails.map(booking => {
        const day = new Date(booking.date).getDate()
        const month = new Date(booking.date).getMonth() + 1
        const data = [`${day}/${month}`, booking?.price]
        return data
      })
      chartData.unshift(['Day', 'Sales'])
      // chartData.splice(0, 0, ['Day', 'Sales'])

      console.log(chartData)

      console.log(bookingDetails)
      res.send({
        totalRooms,
        totalBookings: bookingDetails.length,
        totalPrice,
        chartData,
        hostSince: timestamp,
      })
    })


    // Guest Statistics -------------------------------
    app.get('/guest-stat', verifyToken, async (req, res) => {
      const { email } = req.user
      const bookingDetails = await bookingsCollection
        .find(
          { 'guest.email': email },
          {
            projection: {
              date: 1,
              price: 1,
            },
          }
        )
        .toArray()

      const totalPrice = bookingDetails.reduce(
        (sum, booking) => sum + booking.price,
        0
      )
      const { timestamp } = await userCollection.findOne(
        { email },
        { projection: { timestamp: 1 } }
      )

      const chartData = bookingDetails.map(booking => {
        const day = new Date(booking.date).getDate()
        const month = new Date(booking.date).getMonth() + 1
        const data = [`${day}/${month}`, booking?.price]
        return data
      })
      chartData.unshift(['Day', 'Sales'])
      // chartData.splice(0, 0, ['Day', 'Sales'])

      console.log(chartData)

      console.log(bookingDetails)
      res.send({
        totalBookings: bookingDetails.length,
        totalPrice,
        chartData,
        guestSince: timestamp,
      })
    })




    // get all room for host --------
    app.get('/my-listings/:email', verifyToken, verifyHost,  async(req, res)=> {
      const email = req.params.email;
      const query = {'host.email' : email}
      const result = await roomCollection.find(query).toArray();
      res.send(result)
    })

    // Send a ping to confirm a successful connection
    await client.db('admin').command({ ping: 1 })
    console.log(
      'Pinged your deployment. You successfully connected to MongoDB!'
    )
  } finally {
    // Ensures that the client will close when you finish/error
  }
}
run().catch(console.dir)

app.get('/', (req, res) => {
  res.send('Hello from StayVista Server..')
})

app.listen(port, () => {
  console.log(`StayVista is running on port ${port}`)
})
