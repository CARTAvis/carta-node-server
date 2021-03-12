.. _configuration:

Configuration options
=====================

.. _config-authentication:

Authentication
--------------

You can generate a private/public key pair in PEM format using ``openssl``:

.. code-block:: shell

    openssl genrsa -out carta_private.pem 4096
    openssl rsa -in carta_private.pem -outform PEM -pubout -out carta_public.pem

.. _config-controller:

Controller Configuration
------------------------

Controller configuration is handled by a configuration file in JSON format, adhering to the `CARTA config schema <config/config_schema.json>`_. Additional details can be found in the auto-generated config documentation in the ``docs`` folder, or the `example config <config/example_config.json>`_. By default, the controller assumes the config file is located at ``/etc/carta/config.json``, but you can change this with the ``--config`` or ``-c`` command line argument when running the controller. 

For external authentication systems, you may need to translate a unique ID (such as email or username) from the authenticated user information to the system user. You can do this by providing a `user lookup table <config/usertable.txt.stub>`_, which is watched by the controller and reloaded whenever it is updated.

You can alter the controller's dashboard appearance by adjusting the ``dashboard`` field in the config file. You can change the banner image and background, and add login instructions or institutional notices.

.. _config-system:

System Configuration
--------------------

The user under which the CARTA controller is running (assumed to be ``carta``) must be given permission to use ``sudo`` to start ``carta_backend`` processes as any authenticated user and stop running ``carta_backend`` processes belonging to authenticated users. We provide a `kill script <scripts/carta_kill_script.sh>`_ which is only able to kill processes matching the name ``carta_backend``. This makes it possible to restrict what processes the ``carta`` user is permitted to kill.

To provide the ``carta`` user with these privileges, you must make modifications to the `sudoers configuration <https://www.sudo.ws/man/1.9.0/sudoers.man.html>`_. An `example sudoers config <config/example_sudoers_conf.stub>`_ is provided. This example allows the ``carta`` user to run ``carta_backend`` only as users belonging to a specific group (assumed to be ``carta-users``), in order to deny access to unauthorized accounts.

.. warning::
    Please only edit your sudoers configuration with ``visudo`` or equivalent.

We strongly suggest serving over HTTPS and redirecting HTTP traffic to HTTPS, especially if handling authentication internally. If you use `nginx <https://www.nginx.com/>`_ as a proxy, you can use `this configuration example <config/example_nginx.conf.stub>`_ as a starting point to redirect incoming traffic from port 443 to port 8000.

You can also use other HTTP servers, such as Apache. Please ensure that they are set up to forward both standard HTTP requests and WebSocket traffic to the correct port.

By default, the controller attempts to write log files to the ``/var/log/carta`` directory. Please ensure that this directory exists and that the ``carta`` user has write permission.
