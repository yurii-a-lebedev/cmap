# Используем базовый образ Python
FROM python:3.10-slim

# Устанавливаем рабочую директорию
WORKDIR /app

# Настраиваем PYTHONPATH для корректного импорта
ENV PYTHONPATH=/app

# Копируем файл зависимостей
COPY app/requirements.txt /app/requirements.txt

# Устанавливаем зависимости
RUN pip install --no-cache-dir -r requirements.txt

# Копируем все файлы приложения
COPY app /app

# Устанавливаем переменную окружения для Flask
ENV FLASK_APP=main.py

# Определяем команду для запуска приложения
CMD ["gunicorn", "-w", "4", "-b", "0.0.0.0:5000", "app.main:app"]

