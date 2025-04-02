const express = require('express');
const bodyParser = require('body-parser');
const { Pool } = require('pg');
const session = require('express-session');
const app = express();
const port = 3000;

// Middleware
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(express.static('public'));
app.set('view engine', 'html');
app.use(express.static(__dirname + '/views'));


// Session management
app.use(session({
  secret: 'your-secret-key',
  resave: false,
  saveUninitialized: true,
  cookie: { secure: false } // For development, set to true in production with HTTPS
}));

// Database connection
const pool = new Pool({
  user: 'grooveon_user',
  host: 'localhost',
  database: 'grooveon',
  password: 'shreya',
  port: 5432,
});

// Authentication middleware
const requireArtistAuth = (req, res, next) => {
  if (!req.session.artistId) {
    return res.redirect('/artist-login');
  }
  next();
};

const requireUserAuth = (req, res, next) => {
  if (!req.session.userId) {
    return res.redirect('/user-login');
  }
  next();
};

// Routes - Serving HTML files
app.get('/', (req, res) => res.sendFile(__dirname + '/views/landing.html'));
app.get('/artist-login', (req, res) => res.sendFile(__dirname + '/views/artist-login.html'));
app.get('/artist-signup', (req, res) => res.sendFile(__dirname + '/views/artist-signup.html'));
app.get('/user-login', (req, res) => res.sendFile(__dirname + '/views/user-login.html'));
app.get('/user-signup', (req, res) => res.sendFile(__dirname + '/views/user-signup.html'));
// Add to server.js under "Routes - Serving HTML files"
app.get('/favorites', (req, res) => res.sendFile(__dirname + '/views/favorites.html'));
app.get('/new-album', (req, res) => res.sendFile(__dirname + '/views/new-album.html'));

// ARTIST AUTHENTICATION
app.post('/artist/signup', async (req, res) => {
  const { username, password, confirm_password } = req.body;
  
  if (password !== confirm_password) {
    return res.status(400).send('Passwords do not match');
  }
  
  try {
    const userExists = await pool.query(
      'SELECT * FROM artists WHERE username = $1', 
      [username]
    );
    
    if (userExists.rows.length > 0) {
      return res.status(400).send('Username already exists');
    }

    const newArtist = await pool.query(
      'INSERT INTO artists (username, password) VALUES ($1, $2) RETURNING id',
      [username, password]
    );
    
    req.session.artistId = newArtist.rows[0].id;
    res.redirect('/artist-dashboard');
  } catch (err) {
    console.error(err);
    res.status(500).send('Error during signup');
  }
});

app.post('/artist/login', async (req, res) => {
  const { username, password } = req.body;
  
  try {
    const result = await pool.query(
      'SELECT id FROM artists WHERE username = $1 AND password = $2',
      [username, password]
    );
    
    if (result.rows.length === 0) {
      return res.status(401).send('Invalid username or password');
    }
    
    req.session.artistId = result.rows[0].id;
    res.redirect('/artist-dashboard');
  } catch (err) {
    console.error(err);
    res.status(500).send('Error during login');
  }
});

// USER AUTHENTICATION
app.post('/user/signup', async (req, res) => {
  const { username, password, confirm_password } = req.body;
  
  if (password !== confirm_password) {
    return res.status(400).send('Passwords do not match');
  }
  
  try {
    const userExists = await pool.query(
      'SELECT * FROM users WHERE username = $1', 
      [username]
    );
    
    if (userExists.rows.length > 0) {
      return res.status(400).send('Username already exists');
    }

    const newUser = await pool.query(
      'INSERT INTO users (username, password) VALUES ($1, $2) RETURNING id',
      [username, password]
    );
    
    req.session.userId = newUser.rows[0].id;
    res.redirect('/user-dashboard');
  } catch (err) {
    console.error(err);
    res.status(500).send('Error during signup');
  }
});

app.post('/user/login', async (req, res) => {
  const { username, password } = req.body;
  
  try {
    const result = await pool.query(
      'SELECT id FROM users WHERE username = $1 AND password = $2',
      [username, password]
    );
    
    if (result.rows.length === 0) {
      return res.status(401).send('Invalid username or password');
    }
    
    req.session.userId = result.rows[0].id;
    res.redirect('/user-dashboard');
  } catch (err) {
    console.error(err);
    res.status(500).send('Error during login');
  }
});

// Logout
app.get('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/');
});

// API ROUTES
// Albums API
app.get('/api/albums', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT a.id, a.name, a.genre, ar.username as artist_name,
        (SELECT json_agg(json_build_object('id', s.id, 'name', s.name))
         FROM songs s WHERE s.album_id = a.id) as songs
      FROM albums a
      JOIN artists ar ON a.artist_id = ar.id
    `);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).send('Error fetching albums');
  }
});

app.get('/api/artist/albums', requireArtistAuth, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT a.id, a.name, a.genre,
        (SELECT json_agg(json_build_object('id', s.id, 'name', s.name))
         FROM songs s WHERE s.album_id = a.id) as songs
      FROM albums a
      WHERE a.artist_id = $1
    `, [req.session.artistId]);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).send('Error fetching albums');
  }
});

app.post('/api/albums', requireArtistAuth, async (req, res) => {
  const { name, genre, songs } = req.body;
  
  try {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      
      const albumRes = await client.query(
        'INSERT INTO albums (artist_id, name, genre) VALUES ($1, $2, $3) RETURNING id',
        [req.session.artistId, name, genre]
      );
      
      const albumId = albumRes.rows[0].id;
      
      for (const songName of songs) {
        await client.query(
          'INSERT INTO songs (album_id, name) VALUES ($1, $2)',
          [albumId, songName]
        );
      }
      
      await client.query('COMMIT');
      res.status(201).json({ success: true, albumId });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error(err);
    res.status(500).send('Error creating album');
  }
});

app.delete('/api/albums/:id', requireArtistAuth, async (req, res) => {
  try {
    await pool.query('DELETE FROM albums WHERE id = $1 AND artist_id = $2', 
      [req.params.id, req.session.artistId]);
    res.status(204).send();
  } catch (err) {
    console.error(err);
    res.status(500).send('Error deleting album');
  }
});

// Favorites API
app.get('/api/favorites', requireUserAuth, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT song_id FROM favorites WHERE user_id = $1',
      [req.session.userId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).send('Error fetching favorites');
  }
});

app.get('/api/favorites/details', requireUserAuth, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT f.song_id, s.name as song_name, al.name as album_name, 
             ar.username as artist_name, al.genre
      FROM favorites f
      JOIN songs s ON f.song_id = s.id
      JOIN albums al ON s.album_id = al.id
      JOIN artists ar ON al.artist_id = ar.id
      WHERE f.user_id = $1
    `, [req.session.userId]);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).send('Error fetching favorites');
  }
});

app.post('/api/favorites', requireUserAuth, async (req, res) => {
  const { song_id } = req.body;
  
  try {
    await pool.query(
      'INSERT INTO favorites (user_id, song_id) VALUES ($1, $2)',
      [req.session.userId, song_id]
    );
    res.status(201).send();
  } catch (err) {
    console.error(err);
    res.status(500).send('Error adding favorite');
  }
});

app.delete('/api/favorites/:song_id', requireUserAuth, async (req, res) => {
  try {
    await pool.query(
      'DELETE FROM favorites WHERE user_id = $1 AND song_id = $2',
      [req.session.userId, req.params.song_id]
    );
    res.status(204).send();
  } catch (err) {
    console.error(err);
    res.status(500).send('Error removing favorite');
  }
});

// Dashboard routes
app.get('/artist-dashboard', requireArtistAuth, (req, res) => {
  res.sendFile(__dirname + '/views/artist-dashboard.html');
});

app.get('/user-dashboard', requireUserAuth, (req, res) => {
  res.sendFile(__dirname + '/views/user-dashboard.html');
});

// Start server
app.listen(port, () => {
  console.log(`GrooveOn server running on http://localhost:${port}`);
});

// Test database connection
pool.query('SELECT NOW()', (err, res) => {
  if (err) {
    console.error('Database connection error', err.stack);
  } else {
    console.log('Database connected at', res.rows[0].now);
  }
});