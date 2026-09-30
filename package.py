import os
import zipfile
import shutil

FILES_TO_ADD = [
    'manifest.json',
    'background.js',
    'content.css',
    'content.js'
]

DIRS_TO_ADD = [
    'icons',
    'popup'
]

ZIP_NAME = 'steamdb-non-chinese-reviews.zip'
XPI_NAME = 'steamdb-non-chinese-reviews.xpi'

def build_package():
    print("Packaging Firefox extension using Python...")
    
    if os.path.exists(ZIP_NAME):
        os.remove(ZIP_NAME)
    if os.path.exists(XPI_NAME):
        os.remove(XPI_NAME)
        
    with zipfile.ZipFile(ZIP_NAME, 'w', zipfile.ZIP_DEFLATED) as zipf:
        for file in FILES_TO_ADD:
            if os.path.exists(file):
                print(f"Adding: {file}")
                zipf.write(file, file.replace('\\', '/'))
            else:
                print(f"Warning: File {file} not found")
                
        for directory in DIRS_TO_ADD:
            if os.path.exists(directory):
                for root, _, files in os.walk(directory):
                    for file in files:
                        full_path = os.path.join(root, file)
                        archive_name = os.path.relpath(full_path).replace('\\', '/')
                        print(f"Adding: {archive_name}")
                        zipf.write(full_path, archive_name)
            else:
                print(f"Warning: Directory {directory} not found")

    shutil.copyfile(ZIP_NAME, XPI_NAME)
    print(f"\nSuccess! Created {ZIP_NAME} and {XPI_NAME} with forward-slash paths.")

if __name__ == '__main__':
    build_package()
