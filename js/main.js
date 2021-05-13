/* Toggle between adding and removing the "responsive" class to topnav when the user clicks on the icon */
function updateNavBar() {
	let x = document.getElementById("myTopnav");
	if (x.className === "topnav") {
		x.className += " responsive";
	} else {
		x.className = "topnav";
	}
}

function validateFileUpload() {
	let valid = true;
	let fuData = document.getElementById('image-upload');
	let FileUploadPath = fuData.value;

	//To check if user upload any file
	if (FileUploadPath === '') {
		fuData.setCustomValidity("Please upload an image");
		fuData.classList.add('is-invalid');
		valid = false;
	} else {
		fuData.setCustomValidity("");
		fuData.classList.remove('is-invalid');
		let Extension = FileUploadPath.substring(
			FileUploadPath.lastIndexOf('.') + 1).toLowerCase();

		//The file uploaded is an image

		if (Extension === "gif" || Extension === "png" || Extension === "bmp"
			|| Extension === "jpeg" || Extension === "jpg") {

			// To Display
			if (fuData.files && fuData.files[0]) {
				let reader = new FileReader();
				reader.onload = function (e) {
					document.getElementById('blah').src = e.target.result;
				}
				reader.readAsDataURL(fuData.files[0]);
			}

		}

		//The file upload is NOT an image
		else {
			fuData.setCustomValidity("Please upload an image");
			fuData.classList.add('is-invalid');
			valid = false;
		}
	}
	return valid;
}

async function getURL(uuid, name){

	fetch("/photo/"+ uuid+ "/" + name)
		.then((response) => response.json())
		.then((data) => {
			return data.signed;
		})
		.catch((error) => {
			console.error("Error: ", error);
		});
}


