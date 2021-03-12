.. _focal_instructions:

Detailed instructions for Ubuntu 20.04.2 (Focal Fossa)
======================================================

Dependencies
------------

Install the CARTA backend
~~~~~~~~~~~~~~~~~~~~~~~~~

.. code-block:: shell

    # Add CARTA PPA
    sudo add-apt-repository ppa:confluence/idia-carta
    sudo apt-get update

    # Install the development backend package with all dependencies
    sudo apt-get install carta-backend-beta

Set up directories and permissions
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

.. code-block:: shell

    # log directory owned by carta
    sudo mkdir -p /var/log/carta
    sudo chown carta: /var/log/carta

    # config directory owned by carta
    sudo mkdir -p /etc/carta
    sudo chown carta: /etc/carta

    # edit sudoers file to allow passwordless sudo execution of 
    # /home/carta/bin/carta_kill_script.sh and /home/carta/bin/carta_backend
    # by the carta user  
    sudo visudo -f /etc/sudoers.d/carta_controller

Configure nginx
~~~~~~~~~~~~~~~

This bit should be entirely adapted to fit your server configuration. The relevant part of the config is for forwarding `/` to port 8000.

.. code-block:: nginx

    location / {
            proxy_set_header X-Forwarded-For $remote_addr;
            proxy_pass http://localhost:8000/;
            proxy_http_version 1.1;
            proxy_set_header Upgrade $http_upgrade;
            proxy_set_header Connection 'upgrade';
            proxy_set_header Host $host;
            proxy_cache_bypass $http_upgrade;
        }

Install CARTA controller
~~~~~~~~~~~~~~~~~~~~~~~~

Assuming this runs as user `carta`.

.. code-block:: shell

    # Install NVM and NPM
    cd ~
    curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.37.2/install.sh | bash
    source .bashrc
    nvm install --lts
    nvm install-latest-npm

    # Install carta-controller (includes frontend config)
    npm install -g carta-controller
    cp ${NVM_BIN}/../lib/node_modules/carta-controller/scripts/carta_kill_script.sh

    # Ensure bin folder is added to path
    source ~/.profile

    # Generate JWT keys and edit config
    cd /etc/carta
    openssl genrsa -out carta_private.pem 4096
    openssl rsa -in carta_private.pem -outform PEM -pubout -out carta_public.pem
    nano config.json

    # Install PM2 node service
    npm install -g pm2
    pm2 start carta-controller
