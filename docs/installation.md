# Installation Guide

This guide will help you set up and run DirStudio locally.

---

## 📋 Prerequisites

Ensure you have the following installed:

- **Python 3.10+**
- **uv** (Python package manager)
  
---

## 📥 Clone the Repository

```bash
git clone https://github.com/j4nya-BinSrcs/dirstudio.git
cd dirstudio
```

## 🔐 Environment Setup

DirStudio uses environment variables for secure configuration.

1. Create .env file
Create the following file:
    `dirstudio/server/.env`

2. Add your API key
    `MISTRAL_API_KEY=your_api_key_here`

## 📦 Install Dependencies

Navigate to the backend directory:
    `cd dirstudio/server`

Install required packages:
    `uv sync`

## 🚀 Running the Application

Return to the project root:
    `cd ../..`

🐧 Linux / macOS: 
`./launch.sh`

🪟 Windows: 
`launch.bat`

## 🌐 Access the Application

Once both servers are running, open your browser:

`http://localhost:3000`

---

## **⚙️ Ports Used**
**Service	Port**

Frontend: 	3000 <br>
Backend:    8000

---

## ❗ Troubleshooting

**API Key Not Detected**
- Ensure .env is located in dirstudio/server/
- Verify MISTRAL_API_KEY is correctly set
- Confirm backend loads .env with override=True

**Port Already in Use**

If ports are occupied:

- Change ports in launch scripts
  
    or
  
- Kill existing processes using those ports

**Python Not Found**

Ensure Python is installed and added to PATH:

`python --version`

**Dependency Issues**

Reinstall dependencies:
`pip install --upgrade -r requirements.txt`
or 
`uv sync`

## 🧼 Optional: Virtual Environment Setup

**Create a virtual environment:**

`python -m venv venv`


**Activate it:**
- Linux / macOS
`source venv/bin/activate`
- Windows
`venv\Scripts\activate`
