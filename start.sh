docker-compose down -v
rm -rf app/__pycache__
docker-compose build --no-cache
docker-compose up -d
sleep 3
docker logs cmap 
