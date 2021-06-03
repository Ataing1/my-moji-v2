function validateFileUpload() {
	let valid = true;
	let fuData = document.getElementById('image-upload');
	let FileUploadPath = fuData.value;

	//To check if user upload any file
	if (FileUploadPath === '') {
		alert("please upload an image");
		valid = false;
	} else {
		let Extension = FileUploadPath.substring(FileUploadPath.lastIndexOf('.') + 1).toLowerCase();

		if (Extension === "gif" || Extension === "png" || Extension === "bmp" || Extension === "jpeg" || Extension === "jpg") {
			// To Display
			if (fuData.files && fuData.files[0]) {
				let reader = new FileReader();
				reader.onload = function (e) {
					document.getElementById('blah').src = e.target.result;
				}
				reader.readAsDataURL(fuData.files[0]);
			}
		}
		else {
			alert("please upload an image");
			valid = false;
		}
	}
	return valid;
}

/* When the user clicks on the button,
toggle between hiding and showing the dropdown content */
function showDropDown() {
	document.getElementById("myDropdown").classList.toggle("show");
}

// Close the dropdown menu if the user clicks outside of it
window.onclick = function (event) {
	if (!event.target.matches('.dropdown-button')) {
		var dropdowns = document.getElementsByClassName("dropdown-content");
		var i;
		for (i = 0; i < dropdowns.length; i++) {
			var openDropdown = dropdowns[i];
			if (openDropdown.classList.contains('show')) {
				openDropdown.classList.remove('show');
			}
		}
	}
}

