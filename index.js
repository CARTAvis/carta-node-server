const express = require("express");
const bodyParser = require('body-parser');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
const fs = require("fs");
// Auth config
const config = require("./config.js");
const privateKey = fs.readFileSync(config.privateKeyLocation);
const publicKey = fs.readFileSync(config.publicKeyLocation);

let app = express();
const port = process.env.PORT || 8000;

app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(cookieParser());

handleLogin = (req, res) => {
    if (!req.body) {
        res.status(400).json({
            success: false,
            message: "Malformed login request"
        });
        return;
    }

    const username = req.body.username;
    const password = req.body.password;

    // Dumy auth
    if (username !== config.dummyUsername || password !== config.dummyPassword) {
        res.status(403).json({
            success: false,
            message: "Invalid username/password combo"
        });
        return;
    } else {
        const token = jwt.sign({
            username: username,
            backendSocket: config.backendSocket
        }, privateKey, { algorithm: config.keyAlgorithm, expiresIn: '1h' });
        res.cookie(config.tokenName, token, { maxAge: 1000 * 60 * 60 });
        res.json({
            success: true,
            message: "Successfully authenticated"
        });
    }
}

handleGet = (req, res) => {
    const tokenCookie = req.cookies[config.tokenName];
    if (tokenCookie) {
        try {
            const token = jwt.verify(tokenCookie, publicKey, { algorithm: config.algorithm });
            res.json({
                success: true,
                message: `Authorised as ${token.username}`
            });
            return;
        } catch (err) {
            res.json({
                success: false,
                message: err
            });
            return;
        }
    } else {
        res.status(403).json({
            success: false,
            message: "Not authorized"
        });
    }
}

app.post("/login", handleLogin);
app.get("/test", handleGet);
app.listen(port, () => console.log(`Started listening for login requests on port ${port}`));