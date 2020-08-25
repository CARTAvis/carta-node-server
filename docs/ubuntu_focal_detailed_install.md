# Detailed instructions for setting up `carta-node-server` on Ubuntu 20.04.1 (Focal Fossa)

## Dependencies:
### Install required packages
```shell script
# assuming user "ubuntu" with home directory /home/ubuntu
sudo apt update
sudo apt install -y git software-properties-common cmake pkg-config subversion g++ gfortran libzstd-dev \
libfmt-dev libprotobuf-dev protobuf-compiler libhdf5-dev libtbb-dev libssl-dev libcurl4-openssl-dev \
libgsl-dev nginx build-essential libncurses5-dev libreadline-dev flex bison libblas-dev \
liblapacke-dev libcfitsio-dev wcslib-dev mongodb libgrpc++-dev protobuf-compiler-grpc libpugixml-dev
```

### Compile other dependencies 
```shell script
mkdir -p repos

# ZFP
cd ~/repos
git clone --branch 0.5.5 https://github.com/LLNL/zfp.git
cd zfp
mkdir -p build && cd build
cmake -DCMAKE_BUILD_TYPE=Release ..
make -j`nproc` && sudo make install

# uWebSockets
cd ~/repos
git clone --branch v0.14.8 https://github.com/uNetworking/uWebSockets.git
cd uWebSockets
make
sudo make install
# /usr/lib64 is not in the path in 20.04, manually install
sudo cp libuWS.so /usr/local/lib/
sudo ldconfig

# cascore-data (From KERN-7 PPA)
sudo add-apt-repository -y ppa:kernsuite/kern-7
sudo apt update
sudo apt install -y casacore-data

# carta-casacore (To be replaced by PPA package soon)
cd ~/repos
git clone https://github.com/CARTAvis/carta-casacore.git
cd carta-casacore
git submodule init && git submodule update
cd casa6
git submodule init && git submodule update
cd ../
mkdir -p build && cd build
cmake -DUSE_FFTW3=ON -DUSE_HDF5=ON -DUSE_THREADS=ON -DUSE_OPENMP=ON -DCMAKE_BUILD_TYPE=Release -DBUILD_TESTING=OFF -DBUILD_PYTHON=OFF -DUseCcache=1 -DHAS_CXX11=1 -DDATA_DIR=/usr/share/casacore/data ..
# Use as many cores as you can here
make -j`nproc`
sudo make install
```

# Additional directories and permissions
```shell script
# log directory owned by carta
sudo mkdir -p /var/log/carta
sudo chown carta: /var/log/carta

# config directory owned by carta
sudo mkdir -p /etc/carta
sudo chown carta: /etc/carta

# edit sudoers file to allow passwordless sudo execution of 
# /home/carta/bin/carta_kill_script.sh and /home/carta/bin/carta_backend
# by the carta user  
sudo visudo -f /etc/sudoers.d/carta_server
``` 

## CARTA Backend install
Assuming this runs as user `carta`

```shell script
cd ~
mkidr -p repos && cd repos
git clone --branch v1.4.0-beta.1 https://github.com/CARTAvis/carta-backend.git
cd carta-backend
git submodule init && git submodule update
mkdir -p build && cd build
cmake -DCMAKE_BUILD_TYPE=Release -DEnableAvx=On ../
make -j`nproc`
mkdir -p ~/bin
cp carta_backend ~/bin/
```  

## nginx server config
This bit should be entirely adapted to fit your server configuration. The relevant part of the config is for forwarding `/` to port 8000.
```nginx
location / {
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_pass http://localhost:8000/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }

```

## CARTA Server install
Assuming this runs as user `carta`
```shell script
cd ~
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.35.3/install.sh | bash
source .bashrc
nvm install --lts
nvm install-latest-npm

# Install carta-node-server (includes frontend config)
npm install -g carta-node-server
cp ${NVM_BIN}/../lib/node_modules/carta-node-server/scripts/carta_kill_script.sh

# ensure bin folder is added to path
source ~/.profile

# Generate JWT keys and edit config
cd /etc/carta
openssl genrsa -out carta_private.pem 4096
openssl rsa -in carta_private.pem -outform PEM -pubout -out carta_public.pem
nano config.json

# Install PM2 node service
npm install -g pm2
pm2 start carta-node-server
```