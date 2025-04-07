require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
const mysql = require('mysql2/promise');
const app = express();
const PORT = process.env.PORT || 3000;

// MySQL Connection Config
const dbConfig = {
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'anonymousMessaging',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
};

let pool;

// Connect to MySQL
async function connectToMySQL() {
  try {
    // Create connection pool
    pool = mysql.createPool(dbConfig);
    
    // Test connection
    const connection = await pool.getConnection();
    console.log('Connected to MySQL database');
    
    // Initialize database tables if needed
    await initializeDatabase();
    
    connection.release();
    return pool;
  } catch (error) {
    console.error('MySQL connection error:', error);
    process.exit(1);
  }
}

// Initialize database and tables
async function initializeDatabase() {
  try {
    const connection = await pool.getConnection();
    
    // Create profiles table
    await connection.query(`
      CREATE TABLE IF NOT EXISTS profiles (
        id VARCHAR(255) PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        password VARCHAR(255) NOT NULL,
        headerText VARCHAR(255) DEFAULT 'Kirim Pesan Anonim',
        profileImage TEXT,
        createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        passwordUpdatedAt TIMESTAMP NULL
      )
    `);
    
    // Create messages table
    await connection.query(`
      CREATE TABLE IF NOT EXISTS messages (
        messageId INT AUTO_INCREMENT PRIMARY KEY,
        recipientId VARCHAR(255) NOT NULL,
        message TEXT NOT NULL,
        timestamp BIGINT NOT NULL,
        read BOOLEAN DEFAULT FALSE,
        readAt TIMESTAMP NULL,
        createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (recipientId) REFERENCES profiles(id) ON DELETE CASCADE
      )
    `);
    
    console.log('Database tables initialized');
    connection.release();
  } catch (error) {
    console.error('Error initializing database:', error);
    throw error;
  }
}

// Middleware
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

// Helper functions for MySQL operations
async function getProfile(profileId) {
  const [rows] = await pool.query('SELECT * FROM profiles WHERE id = ?', [profileId]);
  return rows.length > 0 ? rows[0] : null;
}

async function saveProfile(profileId, profileData) {
  const { name, password, headerText, profileImage, passwordUpdatedAt } = profileData;
  
  // Check if profile exists
  const [existingRows] = await pool.query('SELECT id FROM profiles WHERE id = ?', [profileId]);
  
  if (existingRows.length > 0) {
    // Update existing profile
    const updateQuery = `
      UPDATE profiles 
      SET name = ?, 
          password = ?, 
          headerText = ?, 
          profileImage = ?,
          passwordUpdatedAt = ?
      WHERE id = ?
    `;
    await pool.query(updateQuery, [
      name, 
      password, 
      headerText || 'Kirim Pesan Anonim', 
      profileImage || '', 
      passwordUpdatedAt, 
      profileId
    ]);
  } else {
    // Insert new profile
    const insertQuery = `
      INSERT INTO profiles (id, name, password, headerText, profileImage) 
      VALUES (?, ?, ?, ?, ?)
    `;
    await pool.query(insertQuery, [
      profileId, 
      name, 
      password, 
      headerText || 'Kirim Pesan Anonim', 
      profileImage || ''
    ]);
  }
  
  return { success: true };
}

async function getMessages(profileId) {
  const [rows] = await pool.query(
    'SELECT * FROM messages WHERE recipientId = ? ORDER BY timestamp DESC', 
    [profileId]
  );
  return rows;
}

async function saveMessage(message) {
  const { recipientId, message: messageText, timestamp } = message;
  
  const [result] = await pool.query(
    'INSERT INTO messages (recipientId, message, timestamp) VALUES (?, ?, ?)',
    [recipientId, messageText, timestamp]
  );
  
  return { insertId: result.insertId };
}

async function updateMessage(messageId, updates) {
  const { read, readAt } = updates;
  
  await pool.query(
    'UPDATE messages SET `read` = ?, readAt = ? WHERE messageId = ?',
    [read, readAt, messageId]
  );
  
  return { success: true };
}

async function deleteMessage(messageId) {
  await pool.query('DELETE FROM messages WHERE messageId = ?', [messageId]);
  return { success: true };
}

async function deleteAllMessages(profileId) {
  await pool.query('DELETE FROM messages WHERE recipientId = ?', [profileId]);
  return { success: true };
}

async function getAllProfiles() {
  const [rows] = await pool.query('SELECT id, name, headerText, profileImage, createdAt, updatedAt FROM profiles');
  return rows;
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
        password,
        headerText: 'Kirim Pesan Anonim',
        profileImage: '',
      };
      await saveProfile(id, profile);
      profile = await getProfile(id); // Get freshly created profile
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
      profileImage: profileImage || profile.profileImage
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
    // Check if recipient profile exists
    const profile = await getProfile(recipientId);
    
    if (!profile) {
      return res.json({ success: false, message: 'Recipient profile not found' });
    }
    
    // Create new message
    const newMessage = {
      recipientId,
      message,
      timestamp: timestamp || Date.now()
    };
    
    // Save message
    const result = await saveMessage(newMessage);
    
    return res.json({ 
      success: true, 
      messageId: result.insertId
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

// Connect to MySQL before starting the server
connectToMySQL().then(() => {
  // Start server
  const server = app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
    console.log(`Visit http://localhost:${PORT} to access the admin panel`);
    console.log(`Visit http://localhost:${PORT}/ngl.html to access the message form`);
  });
});

// Di akhir file setelah app.listen()
module.exports = app;
