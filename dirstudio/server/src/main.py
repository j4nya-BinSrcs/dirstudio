import asyncio
from services.scanning import scan_directory

def main():
    print("Hello from server!")
    tree = asyncio.run(scan_directory("Z:\\media"))
    tree.to_json("Z:\\test.json")
    print(tree)

if __name__ == "__main__":
    main()
