.. _introduction:

Introduction
============

The CARTA controller provides a simple dashboard which authenticates users and allows them to manage their CARTA backend processes. It also serves static frontend code to clients, and dynamically redirects authenticated client connections to the appropriate backend processes. The controller can either handle authentication itself, or delegate it to an external OAuth2-based authentication server.

.. _dependencies:

Dependencies
------------

To allow the controller to serve CARTA sessions, you must give it access to an executable CARTA backend, which can be either a compiled executable or a container. If you want to use a non-standard version of the CARTA frontend, you must also build it, and adjust the controller configuration to point to it. You should use the ``v2.0.0-dev.21.03.05`` tag of `the CARTA backend <https://github.com/CARTAvis/carta-backend>`_.

By default, the controller runs on port 8000. It should be run behind a proxy, so that it can be accessed via HTTP and HTTPS. 

MongoDB is required for storing user preferences, layouts and (in the near future) controller metrics. You also need a working `NodeJS LTS <https://github.com/nvm-sh/nvm#long-term-support>`_ installation with NPM. Use ``npm install`` to install all Node dependencies.

.. _authentication:

Authentication support
----------------------

The CARTA controller supports three modes for authentication. All three modes use refresh and access tokens, as described in the `OAuth2 Authorization flow <https://tools.ietf.org/html/rfc6749#section-1.3.1>`_, stored in `JWT <https://jwt.io/>`_ format. The modes are:
* **LDAP-based authentication**: An existing LDAP server is used for user authentication. After the user's username and password configuration are validated by the LDAP server, ``carta-controller`` returns a long-lived refresh token, signed with a private key, which can be exchanged by the CARTA dashboard or the CARTA frontend client for a short-lived access token.
* **Google authentication**: Google's authentication libraries are used for handling authentication. You must create a new web application in the `Google API console <https://console.developers.google.com/apis/credentials>`_. You will then use the  client ID provided by this application in a number of places during the configuration.
* **External authentication**: This allows users to authenticate with some external OAuth2-based authentication system. This requires a fair amount of configuration, and has not been well-tested. It is assumed that the refresh token passed by the authentication system is stored as an ``HttpOnly`` cookie.

.. _getting_help:

Getting help
------------

If you encounter a problem with the controller or documentation, please submit an issue in the controller repo. If you need assistance in configuration or deployment, please contact the `CARTA helpdesk <mailto:carta_helpdesk@asiaa.sinica.edu.tw>`_.

.. _future_work:

Future work
-----------

Features still to be implemented:

* Better error feedback
* More flexibility with external auth
