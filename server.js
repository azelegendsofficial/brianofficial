const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
const { MongoClient, ObjectId } = require('mongodb');
const app = express();
const PORT = process.env.PORT || 3000;

// MongoDB Connection URI - use environment variable in production
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb+srv://brianofficial:briangila@cluster0.mongodb.net/anonymousMessaging?retryWrites=true&w=majority';
let db;

// Connect to MongoDB
async function connectToMongoDB() {
  try {
    const client = new MongoClient(MONGODB_URI);
    await client.connect();
    console.log('Connected to MongoDB');
    db = client.db('anonymousMessaging');
    
    // Create indexes for better performance
    await db.collection('profiles').createIndex({ id: 1 }, { unique: true });
    await db.collection('messages').createIndex({ recipientId: 1 });
    
    return client;
  } catch (error) {
    console.error('MongoDB connection error:', error);
    process.exit(1);
  }
}

// Middleware
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

// Helper functions for MongoDB operations
async function getProfile(profileId) {
  return await db.collection('profiles').findOne({ id: profileId });
}

async function saveProfile(profileId, profileData) {
  const result = await db.collection('profiles').updateOne(
    { id: profileId },
    { $set: profileData },
    { upsert: true }
  );
  return result;
}

async function getMessages(profileId) {
  return await db.collection('messages')
    .find({ recipientId: profileId })
    .sort({ timestamp: -1 })
    .toArray();
}

async function saveMessage(message) {
  const result = await db.collection('messages').insertOne(message);
  return result;
}

async function updateMessage(messageId, updates) {
  const result = await db.collection('messages').updateOne(
    { _id: new ObjectId(messageId) },
    { $set: updates }
  );
  return result;
}

async function deleteMessage(messageId) {
  const result = await db.collection('messages').deleteOne({ _id: new ObjectId(messageId) });
  return result;
}

async function deleteAllMessages(profileId) {
  const result = await db.collection('messages').deleteMany({ recipientId: profileId });
  return result;
}

async function getAllProfiles() {
  return await db.collection('profiles')
    .find({}, { projection: { password: 0 } })
    .toArray();
}

// Routes
// Serve HTML files
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin-panel.html'));
});

app.get('/ngl.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'ngl.html'));
});

// API endpoints
// Login endpoint
app.post('/api/login', async (req, res) => {
  const { id, name, password } = req.body;
  
  if (!id || !name || !password) {
    return res.json({ success: false, message: 'Missing required fields' });
  }
  
  try {
    let profile = await getProfile(id);
    
    // If profile doesn't exist, create a new one
    if (!profile) {
      profile = {
        id,
        name,
        password, // In a real app, you'd hash this password
        headerText: 'Kirim Pesan Anonim',
        profileImage: '',
        createdAt: new Date()
      };
      await saveProfile(id, profile);
    } 
    // If profile exists, verify password
    else if (profile.password !== password) {
      return res.json({ success: false, message: 'Invalid credentials' });
    }
    
    // Return success without sending password back
    const { password: _, ...safeProfile } = profile;
    return res.json({ success: true, ...safeProfile });
  } catch (error) {
    console.error('Login error:', error);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

// Get profile
app.get('/api/profile/:id', async (req, res) => {
  const profileId = req.params.id;
  
  try {
    const profile = await getProfile(profileId);
    
    if (!profile) {
      return res.json({ 
        name: 'Anonymous', 
        headerText: 'Kirim Pesan Anonim',
        profileImage: ''
      });
    }
    
    // Don't send password back
    const { password, ...safeProfile } = profile;
    return res.json(safeProfile);
  } catch (error) {
    console.error('Get profile error:', error);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

// Update profile
app.post('/api/profile/update', async (req, res) => {
  const { id, name, headerText, profileImage } = req.body;
  
  if (!id) {
    return res.json({ success: false, message: 'Profile ID is required' });
  }
  
  try {
    const profile = await getProfile(id);
    
    if (!profile) {
      return res.json({ success: false, message: 'Profile not found' });
    }
    
    // Update profile data
    const updatedProfile = {
      ...profile,
      name: name || profile.name,
      headerText: headerText || profile.headerText,
      profileImage: profileImage || profile.profileImage,
      updatedAt: new Date()
    };
    
    // Save updated profile
    await saveProfile(id, updatedProfile);
    
    return res.json({ success: true });
  } catch (error) {
    console.error('Update profile error:', error);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

// Send message
app.post('/api/message', async (req, res) => {
  const { recipientId, message, timestamp } = req.body;
  
  if (!recipientId || !message) {
    return res.json({ success: false, message: 'Missing required fields' });
  }
  
  try {
    // Create new message
    const newMessage = {
      recipientId,
      message,
      timestamp: timestamp || Date.now(),
      read: false,
      createdAt: new Date()
    };
    
    // Save message
    const result = await saveMessage(newMessage);
    
    return res.json({ 
      success: true, 
      messageId: result.insertedId.toString()
    });
  } catch (error) {
    console.error('Send message error:', error);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

// Get messages
app.get('/api/messages/:id', async (req, res) => {
  const profileId = req.params.id;
  
  try {
    const messages = await getMessages(profileId);
    
    return res.json({ success: true, messages });
  } catch (error) {
    console.error('Get messages error:', error);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

// Mark message as read
app.post('/api/message/read', async (req, res) => {
  const { profileId, messageId } = req.body;
  
  if (!profileId || !messageId) {
    return res.json({ success: false, message: 'Missing required fields' });
  }
  
  try {
    await updateMessage(messageId, { 
      read: true,
      readAt: new Date()
    });
    
    return res.json({ success: true });
  } catch (error) {
    console.error('Mark message read error:', error);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

// Delete message
app.post('/api/message/delete', async (req, res) => {
  const { profileId, messageId } = req.body;
  
  if (!profileId || !messageId) {
    return res.json({ success: false, message: 'Missing required fields' });
  }
  
  try {
    await deleteMessage(messageId);
    
    return res.json({ success: true });
  } catch (error) {
    console.error('Delete message error:', error);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

// Delete all messages
app.post('/api/messages/delete-all', async (req, res) => {
  const { profileId } = req.body;
  
  if (!profileId) {
    return res.json({ success: false, message: 'Profile ID is required' });
  }
  
  try {
    await deleteAllMessages(profileId);
    
    return res.json({ success: true });
  } catch (error) {
    console.error('Delete all messages error:', error);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

// Get all profiles (for admin panel)
app.get('/api/profiles', async (req, res) => {
  try {
    const profiles = await getAllProfiles();
    
    return res.json({ success: true, profiles });
  } catch (error) {
    console.error('Get profiles error:', error);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

// Change password
app.post('/api/profile/change-password', async (req, res) => {
  const { id, currentPassword, newPassword } = req.body;
  
  if (!id || !currentPassword || !newPassword) {
    return res.json({ success: false, message: 'Missing required fields' });
  }
  
  try {
    const profile = await getProfile(id);
    
    if (!profile) {
      return res.json({ success: false, message: 'Profile not found' });
    }
    
    if (profile.password !== currentPassword) {
      return res.json({ success: false, message: 'Current password is incorrect' });
    }
    
    // Update password
    profile.password = newPassword;
    profile.passwordUpdatedAt = new Date();
    
    // Save updated profile
    await saveProfile(id, profile);
    
    return res.json({ success: true });
  } catch (error) {
    console.error('Change password error:', error);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

// Connect to MongoDB before starting the server
connectToMongoDB().then(() => {
  // Start server
  const server = app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
    console.log(`Visit http://localhost:${PORT} to access the admin panel`);
    console.log(`Visit http://localhost:${PORT}/ngl.html to access the message form`);
  });
});

// Di akhir file setelah app.listen()
module.exports = app;
