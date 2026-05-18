const express = require("express");
const path = require("path");
const bodyParser = require("body-parser");
const session = require("express-session");
const bcrypt = require("bcrypt");
const config = require("./config.js");
const movieModel = require("./movie-model.js");
const userModel = require("./user-model.js");

const app = express();

// Parse urlencoded bodies
app.use(bodyParser.json());

// Session middleware
app.use(session({
  secret: config.sessionSecret,
  resave: false,
  saveUninitialized: true,
  cookie: { secure: false } // Set to true if using HTTPS
}));

// Serve static content in directory 'files'
app.use(express.static(path.join(__dirname, "files")));

app.post("/login", function (req, res) {
  const { username, password } = req.body;
  const user = userModel[username];
  if (user && bcrypt.compareSync(password, user.password)) {
    req.session.user = {
      username,
      firstName: user.firstName,
      lastName: user.lastName,
      loginTime: new Date().toISOString(),
    };
    res.send(req.session.user);
  } else {
    res.sendStatus(401);
  }
});



// Middleware zur Überprüfung der Session
function requireLogin(req, res, next) {
  if (req.session && req.session.user) {
    next(); // Benutzer ist eingeloggt, weiter zum Endpunkt
  } else {
    res.sendStatus(401); // Nicht autorisiert
  }
}

// GET /logout Endpoint mit Zerstörung der Session und Fehlerbehandlung
app.get("/logout", function (req, res) {
  req.session.destroy(function (err) {
    if (err) {
      console.error("Logout failed:", err);
      return res.sendStatus(500);
    }
    res.sendStatus(200);
  });
});

app.get("/session", function (req, res) {
  if (req.session.user) {
    res.send(req.session.user);
  } else {
    res.status(401).json(null);
  }
});

// Ab hier sind alle geschützten Routen mit `requireLogin` abgesichert:

app.get("/movies", requireLogin, function (req, res) {
  const username = req.session.user.username;
  let movies = Object.values(movieModel.getUserMovies(username));
  const queriedGenre = req.query.genre;
  if (queriedGenre) {
    movies = movies.filter((movie) => movie.Genres.indexOf(queriedGenre) >= 0);
  }
  res.send(movies);
});

// Configure a 'get' endpoint for a specific movie
app.get("/movies/:imdbID", requireLogin, function (req, res) {
  const username = req.session.user.username;
  const id = req.params.imdbID;
  const movie = movieModel.getUserMovie(username, id);

  if (movie) {
    res.send(movie);
  } else {
    res.sendStatus(404);
  }
});

// Configure a 'put' endpoint for a specific movie to update or insert a movie
app.put("/movies/:imdbID", requireLogin, function (req, res) {
  const username = req.session.user.username;
  const imdbID = req.params.imdbID;
  const exists = movieModel.getUserMovie(username, imdbID) !== undefined;

  if (!exists) {
    const url = `http://www.omdbapi.com/?i=${encodeURIComponent(imdbID)}&apikey=${config.omdbApiKey.trim()}`;

    fetch(url)
      .then(apiRes => {

        if (!apiRes.ok) {
          return res.sendStatus(apiRes.status);
        }
        return apiRes.text().then(data => {
          let response;
          try {
            response = JSON.parse(data);
          } catch (parseError) {
            console.error('Failed to parse OMDb details response:', parseError);
            return res.sendStatus(500);
          }

          if (response.Response === 'True') {

            const parseList = (str) => (str && str !== 'N/A') ? str.split(',').map(s => s.trim()) : [];


            const convertedMovie = {
              imdbID: response.imdbID,
              Title: response.Title,
              Released: (response.Released && response.Released !== 'N/A') ? new Date(response.Released).toISOString().split('T')[0] : null,
              Runtime: (response.Runtime && response.Runtime !== 'N/A') ? parseInt(response.Runtime, 10) : 0,
              Genres: parseList(response.Genre),
              Directors: parseList(response.Director),
              Writers: parseList(response.Writer),
              Actors: parseList(response.Actors),
              Plot: (response.Plot && response.Plot !== 'N/A') ? response.Plot : '',
              Poster: (response.Poster && response.Poster !== 'N/A') ? response.Poster : '',
              Metascore: (response.Metascore && response.Metascore !== 'N/A') ? parseInt(response.Metascore, 10) : null,
              imdbRating: (response.imdbRating && response.imdbRating !== 'N/A') ? parseFloat(response.imdbRating) : null
            };

            movieModel.setUserMovie(username, imdbID, convertedMovie);
            res.sendStatus(201);
          } else {
            res.sendStatus(404);
          }
        });
      })
      .catch((err) => {

        console.error('OMDb detail API error:', err);
        res.sendStatus(500);
      });
  } else {
    movieModel.setUserMovie(username, imdbID, req.body);
    res.sendStatus(200);
  }
});

app.delete("/movies/:imdbID", requireLogin, function (req, res) {
  const username = req.session.user.username;
  const id = req.params.imdbID;
  if (movieModel.deleteUserMovie(username, id)) {
    res.sendStatus(200);
  } else {
    res.sendStatus(404);
  }
});


app.get("/genres", requireLogin, function (req, res) {

  const username = req.session.user.username;
  const genres = movieModel.getGenres(username);
  genres.sort();
  res.send(genres);
});

/* Task 2.1. Add the GET /search endpoint: Query omdbapi.com and return a list of results */
app.get("/search", requireLogin, function (req, res) {
  const username = req.session.user.username;
  const query = req.query.query;
  if (!query) {
    return res.sendStatus(400);
  }

  const apiKey = config.omdbApiKey.trim();
  
  // UNBEDINGT NOTWENDIGE ÄNDERUNG: &s= anstatt &t=, damit OMDb ein durchsuchbares Array liefert!
  const url = `http://www.omdbapi.com/?apikey=${apiKey}&s=${encodeURIComponent(query)}`;

  const http = require("http");
  http.get(url, (apiRes) => {
    if (apiRes.statusCode !== 200) {
      console.error(`OMDb Server Fehler. Status: ${apiRes.statusCode}`);
      return res.sendStatus(apiRes.statusCode);
    }

    let data = "";
    apiRes.on("data", (chunk) => { data += chunk; });
    apiRes.on("end", () => {
      let response;
      try {
        response = JSON.parse(data);
      } catch (parseError) {
        console.error("Failed to parse OMDb response:", parseError);
        return res.sendStatus(500);
      }

      if (response.Response === "True" && response.Search) {
        const results = response.Search
          .filter(movie => !movieModel.hasUserMovie(username, movie.imdbID))
          .map(movie => ({
            Title: movie.Title,
            imdbID: movie.imdbID,
            Year: isNaN(movie.Year) ? null : parseInt(movie.Year, 10)
          }));
        res.send(results);
      } else {
        console.log("OMDb meldet:", response.Error || "Keine Suchergebnisse.");
        res.send([]);
      }
    });
  }).on("error", (err) => {
    console.error("OMDb API Netzwerkfehler im Backend:", err);
    res.sendStatus(500);
  });
});

app.listen(config.port);

console.log(`Server now listening on http://localhost:${config.port}/`);