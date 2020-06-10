const notyf = new Notyf({
    ripple: true,
    position: {x: "center"},
    types: [{
        type: "warning",
        background: "orange"
    }, {
        type: "info",
        background: "#4c84af",
    }]
});
const apiBase = `${window.location.href}/api`;
let serverCheckHandle;

let authenticationType = "";
let authenticatedUser = "";
let serverRunning = false;

apiCall = (callName, jsonBody, method) => {
    const options = {
        method: method || "get"
    };
    if (jsonBody) {
        options.body = JSON.stringify(jsonBody);
        options.headers = {"Content-Type": "application/json"}
    }
    return fetch(`${apiBase}/${callName}`, options);
}

showMessage = (message, error, elementId) => {
    const statusElement = document.getElementById(elementId || "login-status");

    if (message) {
        statusElement.style.display = "block";
    } else {
        statusElement.style.display = "none";
        return;
    }

    if (error) {
        statusElement.className = "error-message";
    } else {
        statusElement.className = "success-message";
    }
    statusElement.innerHTML = message;
}

setButtonDisabled = (elementId, disabled) => {
    const button = document.getElementById(elementId);
    if (button) {
        button.disabled = disabled;
        if (disabled) {
            button.classList.add("button-disabled");
        } else {
            button.classList.remove("button-disabled")
        }
    }
}

updateServerStatus = async () => {
    let hasServer = false;
    try {
        const res = await apiCall("server/status");
        if (res.ok) {
            const body = await res.json();
            if (body.success && body.running) {
                hasServer = true;
            }
        } else if (res.status === 403) {
            console.log("Authentication has been lost");
            await handleLogout();
        }
    } catch (e) {
        console.log(e);
    }
    updateRedirectURL(hasServer);
    serverRunning = hasServer;
}

updateRedirectURL = (hasServer) => {
    if (hasServer) {
        setButtonDisabled("start", true);
        setButtonDisabled("stop", false);
        let redirectUrl = `${window.location.href}/frontend`;
        const title = `CARTA server running`;
        showMessage(title.link(redirectUrl), false, "carta-status");
    } else {
        setButtonDisabled("stop", true);
        setButtonDisabled("start", false);
        showMessage(`Logged in as ${authenticatedUser}`, false, "carta-status");
    }
}

handleLogin = async () => {
    setButtonDisabled("login", true);
    const username = document.getElementById("username").value;
    const password = document.getElementById("password").value;
    const body = {username, password};

    try {
        const res = await apiCall("auth/login", body, "post");
        if (res.ok) {
            onLoginSucceeded(username, "local");
        } else {
            onLoginFailed(res.status);
        }
    } catch (e) {
        onLoginFailed(500);
    }
    setButtonDisabled("login", false);
};


onLoginFailed = (status) => {
    notyf.error(status === 403 ? "Invalid username/password combination" : "Could not authenticate correctly");
}

onLoginSucceeded = async (username, type) => {
    authenticatedUser = username;
    authenticationType = type;
    notyf.success(`Logged in as ${authenticatedUser}`);
    showLoginForm(false);
    showCartaForm(true);
    clearInterval(serverCheckHandle);
    serverCheckHandle = setInterval(updateServerStatus, 5000);
    await updateServerStatus();
}

handleServerStart = async () => {
    setButtonDisabled("start", true);
    setButtonDisabled("stop", true);
    try {
        try {
            const res = await apiCall("server/start", undefined, "post");
            const body = await res.json();
            if (!body.success) {
                notyf.error("Failed to start CARTA server");
                console.log(body.message);
            } else {
                notyf.success("Started CARTA server successfully");
            }
        } catch (e) {
            console.log(e);
        }
    } catch (e) {
        notyf.error("Failed to start CARTA server");
        console.log(e);
    }
    await updateServerStatus();
}

handleServerStop = async () => {
    setButtonDisabled("start", true);
    setButtonDisabled("stop", true);
    try {
        try {
            const res = await apiCall("server/stop", undefined, "post");
            const body = await res.json();
            if (body.success) {
                notyf.open({type: "info", message: "Stopped CARTA server successfully"});
                await updateServerStatus();
            } else {
                notyf.success("Stopped CARTA server successfully");
                notyf.error("Failed to stop CARTA server");
                console.log(body.message);
            }
        } catch (e) {
            console.log(e);
        }
    } catch (e) {
        notyf.error("Failed to stop CARTA server");
        console.log(e);
    }
}

handleLogout = async () => {
    clearInterval(serverCheckHandle);
    if (authenticationType === "google") {
        await handleGoogleLogout();
    }
    if (serverRunning) {
        await handleServerStop();
    }
    showMessage();
    showCartaForm(false);
    showLoginForm(true);
    // Remove cookie
    document.cookie = "CARTA-Authorization=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;";
}

initGoogleAuth = () => {
    gapi.load("auth2", function () {
        console.log("Google auth loaded");
        gapi.auth2.init();
    });
};

onSignIn = (googleUser) => {
    const profile = googleUser.getBasicProfile();
    const idToken = googleUser.getAuthResponse().id_token;
    document.cookie = `CARTA-Authorization=${idToken};secure;samesite=strict`;
    onLoginSucceeded(profile.getEmail(), "google");
}

handleGoogleLogout = async () => {
    try {
        if (gapi && gapi.auth2) {
            const authInstance = gapi.auth2.getAuthInstance();
            if (authInstance) {
                await authInstance.disconnect();
            }
        }
    } catch (err) {
        notyf.error("Error signing out of Google");
        console.log(err);
    }
}

showCartaForm = (show) => {
    const cartaForm = document.getElementsByClassName("carta-form")[0];
    if (show) {
        cartaForm.style.display = "block";
    } else {
        cartaForm.style.display = "none";

    }
}

showLoginForm = (show) => {
    const loginForm = document.getElementsByClassName("login-form")[0];
    if (show) {
        loginForm.style.display = "block";
    } else {
        loginForm.style.display = "none";

    }
}

window.onload = async () => {
    try {
        const res = await apiCall("auth/status");
        if (res.ok) {
            const body = await res.json();
            if (body.success && body.username) {
                await onLoginSucceeded(body.username, "jwt");
            } else {
                await handleLogout();
            }
        }
    } catch (e) {
        console.log(e);
    }

    // Wire up buttons
    document.getElementById("login").onclick = handleLogin;
    document.getElementById("start").onclick = handleServerStart;
    document.getElementById("stop").onclick = handleServerStop;
    document.getElementById("logout").onclick = handleLogout;
}
