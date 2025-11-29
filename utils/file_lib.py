"""
Library manage files
"""

import os
import json
import shutil
import base64
from datetime import datetime


def make_folder(folder_path):
    """
    Makes a folder at the specified path

    Args:
        folder_path (str): Path to create folder
    """
    os.makedirs(folder_path, exist_ok=True)


def save_to_json(file_path, data):
    """
    Saves data to file_path as json

    Args:
        file_path: String representing filepath to save data to
        data: Dict to save as json

    """
    with open(file_path, "w", encoding="utf-8") as file:
        json.dump(data, file, indent=4)


def read_json(file_path):
    """
    Reads json at file_path and returns corresponding dict

    Args:
        file_path: String representing filepath to get data from

    Returns dict with JSON data
    """
    with open(file_path, "r", encoding="utf-8") as file:
        data_dict = json.load(file)

    return data_dict


def get_files_in_folder(folder_path, valid_extensions=(".jpg", ".jpeg", ".png"), ignore=("liner",)):
    file_paths = []

    for root, _, files in os.walk(folder_path):
        for file in files:
            if file.lower().endswith(valid_extensions):
                file_path = os.path.join(root, file)

                # Check if any ignore string is in the file path
                if not any(ignored_str in file_path for ignored_str in ignore):
                    file_paths.append(file_path)

    return file_paths


def clear_extra_mockups(folder_path):
    for root, _, files in os.walk(folder_path):
        for file in files:
            if file.lower().endswith(".jpg"):

                if file[0] != file[4] and not file.lower().endswith("multi.jpg"):
                    os.remove(os.path.join(root, file))
                else:
                    os.rename(os.path.join(root, file), os.path.join(root, f"{file[0]}.jpg"))


def move_all_files(source_folder, destination_folder, copy=True):
    # Ensure the destination folder exists
    os.makedirs(destination_folder, exist_ok=True)

    # Iterate through the files in the source folder
    for filename in os.listdir(source_folder):
        source_file = os.path.join(source_folder, filename)
        destination_file = os.path.join(destination_folder, filename)

        # Check if it's a file and not a directory
        if os.path.isfile(source_file):
            if copy:
                # Copy the file to the destination
                shutil.copy2(source_file, destination_file)
            else:
                # Move the file to the destination
                shutil.move(source_file, destination_file)


def update_data(data_path, data_dict):
    # Check if the file exists
    if os.path.exists(data_path):
        # Read the existing data from the file
        with open(data_path, "r", encoding="utf-8") as file:
            current_data = json.load(file)
    else:
        # Initialize empty dictionary if file doesn't exist
        current_data = {}

    # Update the current data with data_dict
    current_data.update(data_dict)

    # Write the updated data back to the file
    with open(data_path, "w", encoding="utf-8") as file:
        json.dump(current_data, file, indent=4)


def read_txt_file(file_path):
    try:
        with open(file_path, "r", encoding="utf-8") as file:
            content = file.read()
        return content
    except FileNotFoundError:
        return f"Error: The file '{file_path}' was not found."
    except Exception as e:
        return f"An error occurred: {e}"


def encode_image(image_path):
    with open(image_path, "rb") as image_file:
        return base64.b64encode(image_file.read()).decode("utf-8")


def current_date_string() -> str:
    """Returns today's date as YYYY-MM-DD."""
    return datetime.utcnow().strftime("%Y-%m-%d")
