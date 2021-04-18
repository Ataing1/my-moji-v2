let testButton = document.getElementById("section3button");

let formData = new FormData();//build form data based on artist or feedback page, then use that as body for post call
formData.append("renditions", null);
formData.append("feedback", "new peice of feedback");
testButton.addEventListener('click', e =>{
	fetch("/testing/abc123", {
		method: 'POST',
		body: formData
	}).then(r => r.json());
})



