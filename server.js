const express = require('express');
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');
const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

// Data directories
const DATA_DIR = path.join(__dirname, 'data');
const PROFILES_DIR = path.join(DATA_DIR, 'profiles');
const MESSAGES_DIR = path.join(DATA_DIR, 'messages');

// Ensure data directories exist
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);
if (!fs.existsSync(PROFILES_DIR)) fs.mkdirSync(PROFILES_DIR);
if (!fs.existsSync(MESSAGES_DIR)) fs.mkdirSync(MESSAGES_DIR);

// Helper functions
function getProfilePath(profileId) {
    return path.join(PROFILES_DIR, `${profileId}.json`);
}

function getMessagesPath(profileId) {
    return path.join(MESSAGES_DIR, `${profileId}.json`);
}

function saveProfile(profileId, profileData) {
    fs.writeFileSync(getProfilePath(profileId), JSON.stringify(profileData, null, 2));
}

function saveMessages(profileId, messages) {
    fs.writeFileSync(getMessagesPath(profileId), JSON.stringify(messages, null, 2));
}

function getProfile(profileId) {
    const profilePath = getProfilePath(profileId);
    if (fs.existsSync(profilePath)) {
        return JSON.parse(fs.readFileSync(profilePath, 'utf8'));
    }
    return null;
}

function getMessages(profileId) {
    const messagesPath = getMessagesPath(profileId);
    if (fs.existsSync(messagesPath)) {
        return JSON.parse(fs.readFileSync(messagesPath, 'utf8'));
    }
    return [];
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
app.post('/api/login', (req, res) => {
    const { id, name, password } = req.body;
    
    if (!id || !name || !password) {
        return res.json({ success: false, message: 'Missing required fields' });
    }
    
    let profile = getProfile(id);
    
    // If profile doesn't exist, create a new one
    if (!profile) {
        profile = {
            id,
            name,
            password, // In a real app, you'd hash this password
            headerText: 'Kirim Pesan Anonim',
            profileImage: ''
        };
        saveProfile(id, profile);
        // Create empty messages file
        saveMessages(id, []);
    } 
    // If profile exists, verify password
    else if (profile.password !== password) {
        return res.json({ success: false, message: 'Invalid credentials' });
    }
    
    // Return success without sending password back
    const { password: _, ...safeProfile } = profile;
    return res.json({ success: true, ...safeProfile });
});

// Get profile
app.get('/api/profile/:id', (req, res) => {
    const profileId = req.params.id;
    const profile = getProfile(profileId);
    
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
});

// Update profile
app.post('/api/profile/update', (req, res) => {
    const { id, name, headerText, profileImage } = req.body;
    
    if (!id) {
        return res.json({ success: false, message: 'Profile ID is required' });
    }
    
    const profile = getProfile(id);
    
    if (!profile) {
        return res.json({ success: false, message: 'Profile not found' });
    }
    
    // Update profile data
    profile.name = name || profile.name;
    profile.headerText = headerText || profile.headerText;
    profile.profileImage = profileImage || profile.profileImage;
    
    // Save updated profile
    saveProfile(id, profile);
    
    return res.json({ success: true });
});

// Send message
app.post('/api/message', (req, res) => {
    const { recipientId, message, timestamp } = req.body;
    
    if (!recipientId || !message) {
        return res.json({ success: false, message: 'Missing required fields' });
    }
    
    // Get existing messages
    const messages = getMessages(recipientId);
    
    // Create new message
    const newMessage = {
        id: Date.now().toString(),
        message,
        timestamp: timestamp || Date.now(),
        read: false
    };
    
    // Add to messages array
    messages.push(newMessage);
    
    // Save messages
    saveMessages(recipientId, messages);
    
    return res.json({ success: true, messageId: newMessage.id });
});

// Get messages
app.get('/api/messages/:id', (req, res) => {
    const profileId = req.params.id;
    const messages = getMessages(profileId);
    
    return res.json({ success: true, messages });
});

// Mark message as read
app.post('/api/message/read', (req, res) => {
    const { profileId, messageId } = req.body;
    
    if (!profileId || !messageId) {
        return res.json({ success: false, message: 'Missing required fields' });
    }
    
    const messages = getMessages(profileId);
    const messageIndex = messages.findIndex(m => m.id === messageId);
    
    if (messageIndex === -1) {
        return res.json({ success: false, message: 'Message not found' });
    }
    
    // Mark as read
    messages[messageIndex].read = true;
    
    // Save messages
    saveMessages(profileId, messages);
    
    return res.json({ success: true });
});

// Delete message
app.post('/api/message/delete', (req, res) => {
    const { profileId, messageId } = req.body;
    
    if (!profileId || !messageId) {
        return res.json({ success: false, message: 'Missing required fields' });
    }
    
    const messages = getMessages(profileId);
    const updatedMessages = messages.filter(m => m.id !== messageId);
    
    // Save updated messages
    saveMessages(profileId, updatedMessages);
    
    return res.json({ success: true });
});

// Delete all messages
app.post('/api/messages/delete-all', (req, res) => {
    const { profileId } = req.body;
    
    if (!profileId) {
        return res.json({ success: false, message: 'Profile ID is required' });
    }
    
    // Save empty messages array
    saveMessages(profileId, []);
    
    return res.json({ success: true });
});

// Get all profiles (for admin panel)
app.get('/api/profiles', (req, res) => {
    const profileFiles = fs.readdirSync(PROFILES_DIR);
    const profiles = profileFiles.map(file => {
        const profileData = JSON.parse(fs.readFileSync(path.join(PROFILES_DIR, file), 'utf8'));
        const { password, ...safeProfile } = profileData;
        return safeProfile;
    });
    
    return res.json({ success: true, profiles });
});

// Change password
app.post('/api/profile/change-password', (req, res) => {
    const { id, currentPassword, newPassword } = req.body;
    
    if (!id || !currentPassword || !newPassword) {
        return res.json({ success: false, message: 'Missing required fields' });
    }
    
    const profile = getProfile(id);
    
    if (!profile) {
        return res.json({ success: false, message: 'Profile not found' });
    }
    
    if (profile.password !== currentPassword) {
        return res.json({ success: false, message: 'Current password is incorrect' });
    }
    
    // Update password
    profile.password = newPassword;
    
    // Save updated profile
    saveProfile(id, profile);
    
    return res.json({ success: true });
});

// Start server
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
    console.log(`Visit http://localhost:${PORT} to access the admin panel`);
    console.log(`Visit http://localhost:${PORT}/ngl.html to access the message form`);
});
