

default:
    @just --list

docker-build:
    docker build -t fressh .

docker-run:
    docker run -it --rm fressh