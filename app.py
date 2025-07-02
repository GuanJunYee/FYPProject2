from flask import Flask, render_template, request, redirect, url_for, session, flash
from flask_pymongo import PyMongo
from werkzeug.security import generate_password_hash, check_password_hash
import smtplib, random, os
from dotenv import load_dotenv
from email.mime.text import MIMEText
from flask import jsonify
import re
from datetime import datetime
from werkzeug.utils import secure_filename
from bson import ObjectId
from flask import render_template, session
from datetime import datetime, timedelta
from flask import send_from_directory
import json
import pytz 
from pytz import timezone
import requests
import time
import docx
import mimetypes
from flask import send_from_directory 
from utils.text_extractor import extract_text
from utils.similarity import calculate_similarity,  calculate_cosine_similarity, highlight_matches



app = Flask(__name__)
app.secret_key = 'supersecretkey'  # Change this to something stronger

# MongoDB connection (default local)
app.config['MONGO_URI'] = 'mongodb://localhost:27017/exam_system'
mongo = PyMongo(app)

# Home route → redirect to login
@app.route('/')
def home():
    return redirect(url_for('login'))

# ============================
# 🔐 Login Route
# ============================
@app.route('/login', methods=['GET', 'POST'])
def login():
    if request.method == 'POST':
        user_id = request.form.get('user_id')
        password = request.form.get('password')

        user = mongo.db.users.find_one({'user_id': user_id})
        if user and check_password_hash(user['password'], password):
            session['user_id'] = user['user_id']
            session['name'] = user['name']
            session['role'] = user['role']

            # ✅ Role-based redirection
            if user['role'] == 'student':
                return redirect(url_for('student_dashboard'))
            elif user['role'] == 'lecturer':
                return redirect(url_for('lec_dashboard'))
            else:
                flash('Unknown role assigned to user.', 'danger')
                return redirect(url_for('login'))
        else:
            flash('Invalid UserID or Password', 'danger')

    return render_template('login.html')

# ============================
# 📝 Register Route
# ============================
@app.route('/verify-otp', methods=['POST'])
def verify_otp():
        data = request.get_json()
        email = data.get('email')
        otp_input = data.get('otp')

        record = mongo.db.otps.find_one({'email': email})
        if not record or record['otp'] != otp_input:
            return jsonify(success=False, error="Invalid or expired OTP code")
        return jsonify(success=True)

@app.route('/register', methods=['GET', 'POST'])
def register():
    if request.method == 'GET':
        return render_template('register.html')

    # This is POST logic
    user_id = request.form.get('user_id')
    email = request.form.get('email')
    password = request.form.get('password')
    name = request.form.get('name')
    role = request.form.get('role')
    phone = request.form.get('phone')
    gender = request.form.get('gender')
    otp_input = request.form.get('otp')

    hashed_pw = generate_password_hash(password)

    # Check duplicate user ID
    if mongo.db.users.find_one({'user_id': user_id}):
        flash('User ID already exists', 'danger')
        return redirect(url_for('register'))

    # Check duplicate email
    if mongo.db.users.find_one({'email': email}):
        flash('Email already exists', 'danger')
        return redirect(url_for('register'))
    
    # Save user
    mongo.db.users.insert_one({
        'user_id': user_id,
        'name': name,
        'email': email,
        'password': hashed_pw,
        'role': role,
        'phone': phone,
        'gender': gender
    })

    mongo.db.otps.delete_one({'email': email})
    flash('Registration successful! Please login.', 'success')
    return redirect(url_for('login'))

load_dotenv()  # Load .env file

@app.route('/send-otp', methods=['POST'])
def send_otp():
    data = request.get_json()
    email = data.get('email')
    if not email:
        return jsonify(success=False, error="Email is required"), 400

    otp = str(random.randint(100000, 999999))

    # Try to send email FIRST
    try:
        msg = MIMEText(f"Your verification code is: {otp}")
        msg['Subject'] = 'OTP for Online Exam Registration'
        msg['From'] = os.getenv("EMAIL_USER")
        msg['To'] = email

        with smtplib.SMTP_SSL('smtp.gmail.com', 465) as server:
            server.login(os.getenv("EMAIL_USER"), os.getenv("EMAIL_PASS"))
            server.send_message(msg)
        
        # ONLY save to database if email was sent successfully
        mongo.db.otps.update_one(
            {'email': email},
            {'$set': {'otp': otp, 'created_at': datetime.utcnow()}},
            upsert=True
        )
        
        return jsonify(success=True, message="OTP sent successfully")
        
    except Exception as e:
        print(f"Email sending failed: {e}")
        # Don't save OTP if email failed
        return jsonify(success=False, error="Failed to send OTP. Please try again.")
    
@app.route('/forgot-password', methods=['GET', 'POST'])
def forgot_password():
    return render_template('forgot_password.html')

# ============================
# 🧠 Student Dashboard 
# ============================
@app.route('/student/dashboard')
def student_dashboard():
    if 'user_id' not in session or session.get('role') != 'student':
        flash("Unauthorized access.", "danger")
        return redirect(url_for('login'))
    user = mongo.db.users.find_one({'user_id': session['user_id']})
    return render_template('student_dashboard.html', user=user)

@app.context_processor
def inject_user():
    user = mongo.db.users.find_one({'user_id': session.get('user_id')}) if 'user_id' in session else None
    return dict(user=user)

@app.context_processor
def inject_common_data():
    return dict(current_year=datetime.now().year)   

@app.route('/profile')
def profile():
    if 'user_id' not in session or session.get('role') != 'student':
        flash('Please log in first.', 'danger')
        return redirect(url_for('login'))

    user = mongo.db.users.find_one({'user_id': session['user_id']})
    return render_template('profile.html', user=user)


@app.route('/edit/profile', methods=['GET', 'POST'])
def edit_profile():
    if 'user_id' not in session or session.get('role') != 'student':
        flash('Please log in first.', 'danger')
        return redirect(url_for('login'))

    user = mongo.db.users.find_one({'user_id': session['user_id']})

    if request.method == 'POST':
        # Step 1: Get form data
        name = request.form.get('name')
        email = request.form.get('email')
        phone = request.form.get('phone')
        gender = request.form.get('gender')
        photo_file = request.files.get('photo')

        update_data = {
            'name': name,
            'email': email,
            'phone': phone,
            'gender': gender
        }

        # Step 2: Handle photo upload
        if photo_file and photo_file.filename != '':
            uploads_folder = os.path.join('static', 'uploads')
            os.makedirs(uploads_folder, exist_ok=True)

            # Delete old photo if exists
            old_photo = user.get('photo_url')
            if old_photo and os.path.exists(old_photo[1:]):  # remove leading '/'
                os.remove(old_photo[1:])

            # Save new photo
            filename = secure_filename(photo_file.filename)
            new_filename = f"{ObjectId()}{os.path.splitext(filename)[1]}"
            save_path = os.path.join(uploads_folder, new_filename)
            photo_file.save(save_path)

            update_data['photo_url'] = f"/static/uploads/{new_filename}"

        # Step 3: Update MongoDB
        mongo.db.users.update_one(
            {'user_id': session['user_id']},
            {'$set': update_data}
        )

        # ✅ Step 4: Update session name so navbar shows correct value
        session['name'] = name

        flash('Profile updated successfully!', 'success_redirect')
        return redirect(url_for('profile'))

    return render_template('edit_profile.html', user=user)


@app.route('/reset/password', methods=['GET', 'POST'])
def reset_password():
    if 'user_id' not in session or session.get('role') != 'student':
        flash("You must be logged in to reset your password.", "danger")
        return redirect(url_for('login'))

    errors = {}

    if request.method == 'POST':
        current_password = request.form['current_password']
        new_password = request.form['new_password']
        confirm_password = request.form['confirm_password']

        user = get_user_from_session(session['user_id'])

        if not user:
            errors['current_password'] = "User not found."
        elif not check_password(user['password'], current_password):
            errors['current_password'] = "Current password is incorrect."

        if not re.match(r'^(?=.*[a-zA-Z])(?=.*\d)(?=.*[\W_]).{8,}$', new_password):
            errors['new_password'] = "Password must be at least 8 characters and contain a letter, number, and symbol."

        if new_password != confirm_password:
            errors['confirm_password'] = "Passwords do not match."

        if not errors:
            update_user_password(session['user_id'], new_password)
            flash("Password updated successfully!", "success_redirect")
            return redirect(url_for('profile'))

    return render_template('reset_password.html', errors=errors)

# --- UTILITIES ---
def get_user_from_session(user_id):
    return mongo.db.users.find_one({"user_id": user_id})  # ✅ use 'user_id', NOT '_id'

def check_password(stored_hashed, entered_plain):
    return check_password_hash(stored_hashed, entered_plain)

def update_user_password(user_id, new_password):
    hashed_pw = generate_password_hash(new_password)
    mongo.db.users.update_one({'user_id': user_id}, {'$set': {'password': hashed_pw}})

# ============================
# 🧠 Lecturer Dashboard 
# ============================
@app.route('/lec/dashboard')
def lec_dashboard():
    if 'user_id' not in session or session.get('role') != 'lecturer':
        flash("Unauthorized access.", "danger")
        return redirect(url_for('login'))

    user = mongo.db.users.find_one({'user_id': session['user_id']})
    session['name'] = user.get('name')  # Ensure session.name is set for navbar
    return render_template('lec_dashboard.html', user=user)

@app.route('/lec/profile')
def lec_profile():
    if 'user_id' not in session or session.get('role') != 'lecturer':
        flash('Please log in first.', 'danger')
        return redirect(url_for('login'))

    user = mongo.db.users.find_one({'user_id': session['user_id']})
    return render_template('lec_profile.html', user=user)

@app.route('/lec/edit/profile', methods=['GET', 'POST'])
def lec_edit_profile():
    if 'user_id' not in session or session.get('role') != 'lecturer':
        flash("Unauthorized access.", "danger")
        return redirect(url_for('login'))

    user = mongo.db.users.find_one({'user_id': session['user_id']})

    if request.method == 'POST':
        name = request.form.get('name')
        email = request.form.get('email')
        phone = request.form.get('phone')
        gender = request.form.get('gender')
        photo_file = request.files.get('photo')

        update_data = {
            'name': name,
            'email': email,
            'phone': phone,
            'gender': gender
        }

        # Handle profile photo
        if photo_file and photo_file.filename != '':
            uploads_folder = os.path.join('static', 'uploads')
            os.makedirs(uploads_folder, exist_ok=True)

            # Delete old photo if exists
            old_photo = user.get('photo_url')
            if old_photo and os.path.exists(old_photo[1:]):
                os.remove(old_photo[1:])

            filename = secure_filename(photo_file.filename)
            new_filename = f"{ObjectId()}{os.path.splitext(filename)[1]}"
            save_path = os.path.join(uploads_folder, new_filename)
            photo_file.save(save_path)

            update_data['photo_url'] = f"/static/uploads/{new_filename}"

        # Update DB
        mongo.db.users.update_one(
            {'user_id': session['user_id']},
            {'$set': update_data}
        )

        session['name'] = name  # update displayed name
        flash('Profile updated successfully!', 'success_redirect')
        return redirect(url_for('lec_profile'))

    return render_template('lec_edit_profile.html', user=user)

@app.route('/lec/reset/password', methods=['GET', 'POST'])
def lec_reset_password():
    if 'user_id' not in session or session.get('role') != 'lecturer':
        flash("You must be logged in to reset your password.", "danger")
        return redirect(url_for('login'))

    errors = {}

    if request.method == 'POST':
        current_password = request.form['current_password']
        new_password = request.form['new_password']
        confirm_password = request.form['confirm_password']

        user = lec_get_user_from_session(session['user_id'])

        if not user:
            errors['current_password'] = "User not found."
        elif not lec_check_password(user['password'], current_password):
            errors['current_password'] = "Current password is incorrect."

        if not re.match(r'^(?=.*[a-zA-Z])(?=.*\d)(?=.*[\W_]).{8,}$', new_password):
            errors['new_password'] = "Password must be at least 8 characters and contain a letter, number, and symbol."

        if new_password != confirm_password:
            errors['confirm_password'] = "Passwords do not match."

        if not errors:
            lec_update_user_password(session['user_id'], new_password)
            flash("Password updated successfully!", "success_redirect")
            return redirect(url_for('lec_profile'))

    return render_template('lec_reset_password.html', errors=errors)

# --- UTILITIES ---
def lec_get_user_from_session(user_id):
    return mongo.db.users.find_one({"user_id": user_id})  # ✅ use 'user_id', NOT '_id'

def lec_check_password(stored_hashed, entered_plain):
    return check_password_hash(stored_hashed, entered_plain)

def lec_update_user_password(user_id, new_password):
    hashed_pw = generate_password_hash(new_password)
    mongo.db.users.update_one({'user_id': user_id}, {'$set': {'password': hashed_pw}})

@app.route('/lec/register', methods=['GET', 'POST'])
def lec_register():
    if 'user_id' not in session or session.get('role') != 'lecturer':
        flash("Unauthorized access.", "danger")
        return redirect(url_for('login'))

    errors = {}

    if request.method == 'POST':
        user_id = request.form['user_id']
        name = request.form['name']
        email = request.form['email']
        phone = request.form['phone']
        gender = request.form['gender']
        role = request.form['role']
        password = request.form['password']
        confirm_password = request.form['confirm_password']

        # Check if user ID already exists
        existing_user = mongo.db.users.find_one({'user_id': user_id})
        if existing_user:
            errors['user_id'] = "User ID already exists."

        # Check if email already exists
        existing_user = mongo.db.users.find_one({'email': email})
        if existing_user:
            errors['email'] = "Email already exists."

        # Password match
        if password != confirm_password:
            errors['confirm_password'] = "Passwords do not match."

        # Password strength (optional but recommended)
        import re
        if not re.match(r'^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[\W_]).{8,}$', password):
            errors['password'] = "Password must include uppercase, lowercase, number, and special character."

        # If errors, re-render with error messages
        if errors:
            return render_template('lec_register.html', errors=errors)

        # Save new user
        hashed_pw = generate_password_hash(password)
        new_user = {
            'user_id': user_id,
            'name': name,
            'email': email,
            'phone': phone,
            'gender': gender,
            'role': role,
            'password': hashed_pw,
            'photo_url': "/static/img/default-profile.png"
        }

        mongo.db.users.insert_one(new_user)
        flash("New user registered successfully!", "success_redirect")
        return redirect(url_for('lec_register'))

    return render_template('lec_register.html', errors={})

# ============================
# 🧑‍🎓 Student List 
# ============================
@app.route('/lec/student-list')
def student_list():
    if 'user_id' not in session or session.get('role') != 'lecturer':
        flash("Unauthorized access.", "danger")
        return redirect(url_for('login'))

    gender_filter = request.args.get('gender')
    query = {'role': 'student'}
    
    if gender_filter:
        query['gender'] = gender_filter

    students = mongo.db.users.find(query)
    return render_template('student_list.html', students=students, selected_gender=gender_filter)


@app.route('/lec/student/edit/<student_id>', methods=['GET', 'POST'])
def edit_student(student_id):
    if 'user_id' not in session or session.get('role') != 'lecturer':
        flash("Unauthorized access.", "danger")
        return redirect(url_for('login'))

    student = mongo.db.users.find_one({'_id': ObjectId(student_id)})

    if request.method == 'POST':
        updated_data = {
            'name': request.form['name'],
            'email': request.form['email'],
            'phone': request.form['phone'],
            'gender': request.form['gender']
        }
        mongo.db.users.update_one({'_id': ObjectId(student_id)}, {'$set': updated_data})
        flash("Student updated successfully!", "success")
        return redirect(url_for('student_list'))

    return render_template('edit_student.html', student=student)

# ============================
# 👨‍🏫 Lecturer List 
# ============================
@app.route('/lec/lecturer-list')
def lec_list():
    if 'user_id' not in session or session.get('role') != 'lecturer':
        flash("Unauthorized access.", "danger")
        return redirect(url_for('login'))

    gender_filter = request.args.get('gender')
    query = {'role': 'lecturer'}
    
    if gender_filter:
        query['gender'] = gender_filter

    lecturers = mongo.db.users.find(query)
    return render_template('lec_list.html', lecturers= lecturers, selected_gender=gender_filter)


@app.route('/lec/lecturer/edit/<lecturer_id>', methods=['GET', 'POST'])
def edit_lecturer(lecturer_id):
    if 'user_id' not in session or session.get('role') != 'lecturer':
        flash("Unauthorized access.", "danger")
        return redirect(url_for('login'))

    lecturer = mongo.db.users.find_one({'_id': ObjectId(lecturer_id)})

    if request.method == 'POST':
        updated_data = {
            'name': request.form['name'],
            'email': request.form['email'],
            'phone': request.form['phone'],
            'gender': request.form['gender']
        }
        mongo.db.users.update_one({'_id': ObjectId(lecturer_id)}, {'$set': updated_data})
        flash("Lecturer updated successfully!", "success")
        return redirect(url_for('lec_list'))

    return render_template('edit_lecturer.html', lecturer=lecturer)
# ============================
# 👨‍🏫 Course Management
# ============================
@app.route('/course/manage')
def course_manage():
    if 'user_id' not in session or session.get('role') != 'lecturer':
        flash("Unauthorized access.", "danger")
        return redirect(url_for('login'))

    courses = list(mongo.db.courses.find())  # Fetch all courses
    return render_template('course_manage.html', courses=courses)


@app.route('/lecturer/course/create', methods=['GET', 'POST'])
def course_create():
    if 'user_id' not in session or session.get('role') != 'lecturer':
        flash("Unauthorized access.", "danger")
        return redirect(url_for('login'))

    errors = {}

    if request.method == 'POST':
        course_code = request.form['course_code'].strip()
        course_name = request.form['course_name'].strip()

        # Check if course code exists
        existing = mongo.db.courses.find_one({'course_code': course_code})
        if existing:
            errors['course_code'] = "Course code already exists."
            return render_template('course_create.html', errors=errors, course_code=course_code, course_name=course_name)

        # Insert course
        mongo.db.courses.insert_one({
            'course_code': course_code,
            'course_name': course_name,
            'students': []  # placeholder for enrolled students
        })

        flash("Course created successfully!", "success")
        return redirect(url_for('course_manage'))

    return render_template('course_create.html', errors=errors)

@app.route('/lecturer/course/edit/<course_code>', methods=['GET', 'POST'])
def course_edit(course_code):
    if 'user_id' not in session or session.get('role') != 'lecturer':
        flash("Unauthorized access.", "danger")
        return redirect(url_for('login'))

    course = mongo.db.courses.find_one({'course_code': course_code})
    if not course:
        flash("Course not found.", "danger")
        return redirect(url_for('course_manage'))

    errors = {}

    if request.method == 'POST':
        new_code = request.form['course_code']
        new_name = request.form['course_name']
        students = request.form.getlist('students')

        if new_code != course_code and mongo.db.courses.find_one({'course_code': new_code}):
            errors['course_code'] = "Course code already exists."
            all_students = mongo.db.users.find({'role': 'student'})
            course['course_code'] = new_code
            course['course_name'] = new_name
            course['students'] = students
            return render_template('course_edit.html', course=course, all_students=all_students, errors=errors)

        mongo.db.courses.update_one(
            {'course_code': course_code},
            {'$set': {
                'course_code': new_code,
                'course_name': new_name,
                'students': students
            }}
        )
        flash("Course updated successfully!", "success")
        return redirect(url_for('course_manage'))

    all_students = mongo.db.users.find({'role': 'student'})
    return render_template('course_edit.html', course=course, all_students=all_students, errors={})



# ============================
# 👨‍🏫 Assessment Management
# ============================
@app.route('/lecturer/assessment/manage')
def assessment_manage():
    if 'user_id' not in session or session.get('role') != 'lecturer':
        flash("Unauthorized access.", "danger")
        return redirect(url_for('login'))

    assessments = mongo.db.assessments.find()
    return render_template('assessment_manage.html', assessments=assessments)

@app.route('/lecturer/assessment/create', methods=['GET', 'POST'])
def assessment_create():
    if 'user_id' not in session or session.get('role') != 'lecturer':
        flash("Unauthorized access.", "danger")
        return redirect(url_for('login'))

    errors = {}
    if request.method == 'POST':
        code = request.form['assessment_code']
        title = request.form['title']
        course_codes = request.form.getlist('course_codes')
        file = request.files['question_pdf']

        # Check if code exists
        if mongo.db.assessments.find_one({'assessment_code': code}):
            errors['assessment_code'] = "Assessment code already exists."
            courses = mongo.db.courses.find()
            return render_template('assessment_create.html', courses=courses, errors=errors)

        # Save PDF
        if file and file.filename.endswith('.pdf'):
            filename = secure_filename(code + '_' + file.filename)
            path = os.path.join('static/uploads/assessments', filename)
            file.save(path)
        else:
            flash("Only PDF files are allowed.", "danger")
            return redirect(url_for('assessment_create'))

        # Auto-enroll students
        student_ids = []
        for course_code in course_codes:
            course = mongo.db.courses.find_one({'course_code': course_code})
            if course and 'students' in course:
                student_ids.extend(course['students'])
        student_ids = list(set(student_ids))  # remove duplicates

        # Insert into DB
        mongo.db.assessments.insert_one({
            'assessment_code': code,
            'title': title,
            'course_codes': course_codes,
            'students': student_ids,
            'pdf_filename': filename
        })

        flash("Assessment created successfully!", "success")
        return redirect(url_for('assessment_manage'))

    courses = mongo.db.courses.find()
    return render_template('assessment_create.html', courses=courses, errors={})

@app.route('/lecturer/assessment/edit/<assessment_code>', methods=['GET', 'POST'])
def assessment_edit(assessment_code):
    if 'user_id' not in session or session.get('role') != 'lecturer':
        flash("Unauthorized access.", "danger")
        return redirect(url_for('login'))

    assessment = mongo.db.assessments.find_one({'assessment_code': assessment_code})
    if not assessment:
        flash("Assessment not found.", "danger")
        return redirect(url_for('assessment_manage'))

    courses = list(mongo.db.courses.find())
    all_students = list(mongo.db.users.find({'role': 'student'}))
    errors = {}

    if request.method == 'POST':
        new_code = request.form['assessment_code']
        title = request.form['title']
        selected_courses = request.form.getlist('course_codes')
        selected_students = request.form.getlist('students')
        file = request.files.get('question_pdf')

        # Check if new assessment code is already taken by another record
        if new_code != assessment_code and mongo.db.assessments.find_one({'assessment_code': new_code}):
            errors['assessment_code'] = "Assessment code already exists."
            return render_template('assessment_edit.html', assessment=assessment, courses=courses, all_students=all_students, errors=errors)

        update_data = {
            'assessment_code': new_code,
            'title': title,
            'course_codes': selected_courses,
            'students': selected_students
        }

        # Replace PDF if uploaded
        if file and file.filename.endswith('.pdf'):
            filename = secure_filename(new_code + '_' + file.filename)
            file_path = os.path.join('static/uploads/assessments', filename)
            file.save(file_path)
            update_data['pdf_filename'] = filename

        # Perform the update
        mongo.db.assessments.update_one(
            {'assessment_code': assessment_code},
            {'$set': update_data}
        )

        flash("Assessment updated successfully!", "success")
        return redirect(url_for('assessment_manage'))

    return render_template('assessment_edit.html', assessment=assessment, courses=courses, all_students=all_students, errors={})

# ============================
# 👨‍🏫 Timetable Management
# ============================
@app.route('/lecturer/exam/timetable')
def exam_timetable():
    if 'user_id' not in session or session.get('role') != 'lecturer':
        flash("Unauthorized access.", "danger")
        return redirect(url_for('login'))

    exam_timetables = list(mongo.db.exam_timetables.find())
    assessments = list(mongo.db.assessments.find())
    return render_template('exam_timetable.html', exam_timetables=exam_timetables, assessments=assessments)

from datetime import datetime
from werkzeug.utils import secure_filename

@app.route('/lecturer/exam/timetable/create', methods=['GET', 'POST'])
def exam_timetable_create():
    if 'user_id' not in session or session.get('role') != 'lecturer':
        flash("Unauthorized access.", "danger")
        return redirect(url_for('login'))
    
    errors = {}

    if request.method == 'POST':
        assessment_code = request.form['assessment_code']
        exam_date = request.form['exam_date']
        start_time = request.form['start_time']
        end_time = request.form['end_time']

        # Check if timetable already exists for this assessment
        if mongo.db.exam_timetables.find_one({'assessment_code': assessment_code}):
            errors['assessment_code'] = "Timetable for this assessment already exists"
            assessments = mongo.db.assessments.find()
            return render_template('exam_timetable_create.html', assessments=assessments, errors=errors)

        # Optional: Validate datetime format (HTML input already helps)
        try:
            datetime.strptime(exam_date, '%Y-%m-%d')
        except ValueError:
            flash("Invalid exam date format.", "danger")
            return redirect(url_for('exam_timetable_create'))
        
        # Convert and validate time
        try:
            start_dt = datetime.strptime(f"{exam_date} {start_time}", '%Y-%m-%d %H:%M')
            end_dt = datetime.strptime(f"{exam_date} {end_time}", '%Y-%m-%d %H:%M')

            if end_dt <= start_dt:
                errors['end_time'] = "End time must be later than start time."
        except ValueError:
            errors['end_time'] = "Invalid date or time format."

        if errors:
            assessments = mongo.db.assessments.find()
            return render_template('exam_timetable_create.html', assessments=assessments, errors=errors)

        mongo.db.exam_timetables.insert_one({
            'assessment_code': assessment_code,
            'exam_date': exam_date,
            'start_time': start_time,
            'end_time': end_time
        })

        flash("Exam timetable created successfully!", "success")
        return redirect(url_for('exam_timetable'))

    assessments = mongo.db.assessments.find()
    return render_template('exam_timetable_create.html', assessments=assessments, errors={})


@app.route('/lecturer/exam/timetable/edit/<assessment_code>', methods=['GET', 'POST'])
def exam_timetable_edit(assessment_code):
    if 'user_id' not in session or session.get('role') != 'lecturer':
        flash("Unauthorized access.", "danger")
        return redirect(url_for('login'))

    timetable = mongo.db.exam_timetables.find_one({'assessment_code': assessment_code})
    if not timetable:
        flash("Timetable not found.", "danger")
        return redirect(url_for('exam_timetable'))

    assessments = list(mongo.db.assessments.find())
    errors = {}

    if request.method == 'POST':
        selected_assessment = request.form['assessment_code']
        exam_date = request.form['exam_date']
        start_time = request.form['start_time']
        end_time = request.form['end_time']

        # Time validation
        if start_time >= end_time:
            errors['end_time'] = "End time must be after start time."

        # Check for duplicate if changing assessment code
        if selected_assessment != assessment_code:
            if mongo.db.exam_timetables.find_one({'assessment_code': selected_assessment}):
                errors['assessment_code'] = "Timetable for this assessment already exists."

        if not errors:
            mongo.db.exam_timetables.update_one(
                {'assessment_code': assessment_code},
                {'$set': {
                    'assessment_code': selected_assessment,
                    'exam_date': exam_date,
                    'start_time': start_time,
                    'end_time': end_time
                }}
            )
            flash("Exam timetable updated successfully!", "success")
            return redirect(url_for('exam_timetable'))

        # update the existing data in template
        timetable.update({
            'assessment_code': selected_assessment,
            'exam_date': exam_date,
            'start_time': start_time,
            'end_time': end_time
        })

    return render_template(
        'exam_timetable_edit.html',
        timetable=timetable,
        assessments=assessments,
        errors=errors
    )

# ============================
# 👨‍🏫 Exam Submission Management
# ============================
@app.route('/lecturer/exam/submissions')
def lecturer_submission_overview():
    if 'user_id' not in session or session.get('role') != 'lecturer':
        flash("Unauthorized access.", "danger")
        return redirect(url_for('login'))

    # No filtering by lecturer_id
    assessments = list(mongo.db.assessments.find({}))
    return render_template('lec_submission_overview.html', assessments=assessments)

@app.route('/lecturer/exam/submissions/<assessment_code>')
def lecturer_view_submissions(assessment_code):
    if 'user_id' not in session or session.get('role') != 'lecturer':
        flash("Unauthorized access.", "danger")
        return redirect(url_for('login'))

    assessment = mongo.db.assessments.find_one({'assessment_code': assessment_code})
    if not assessment:
        flash("Assessment not found.", "danger")
        return redirect(url_for('lecturer_submission_overview'))

    submissions = list(mongo.db.submissions.find({'assessment_code': assessment_code}))
    student_ids = [s['student_id'] for s in submissions]
    students = mongo.db.users.find({'user_id': {'$in': student_ids}})
    student_map = {u['user_id']: u for u in students}

    # Build course mapping from student ID to course_name
    course_codes = assessment.get('course_codes', [])
    relevant_courses = mongo.db.courses.find({'course_code': {'$in': course_codes}})
    student_course_map = {}

    for course in relevant_courses:
        for sid in course.get('students', []):
            if sid not in student_course_map:
                student_course_map[sid] = course['course_name']

    resub_requests = mongo.db.resubmission_requests.find({'assessment_code': assessment_code})
    resub_map = {r['submission_id']: r['status'] for r in resub_requests}

    for s in submissions:
        stu = student_map.get(s['student_id'], {})
        s['student_name'] = stu.get('name', 'N/A')
        s['student_course'] = student_course_map.get(s['student_id'], 'Unknown')
        s['status'] = resub_map.get(str(s['_id']))

        if isinstance(s.get('submitted_at'), datetime):
            s['submitted_at'] = s['submitted_at'].astimezone(timezone('Asia/Kuala_Lumpur'))

    return render_template("lec_exam_submissions.html",
                           assessment=assessment,
                           submissions=submissions)

@app.route('/lecturer/exam/resubmission/<submission_id>', methods=['GET', 'POST'])
def lecturer_view_resubmission(submission_id):
    if 'user_id' not in session or session.get('role') != 'lecturer':
        flash("Unauthorized access.", "danger")
        return redirect(url_for('login'))

    # Fetch the resubmission request
    resub = mongo.db.resubmission_requests.find_one({'submission_id': submission_id})
    if not resub:
        flash("Resubmission request not found.", "danger")
        return redirect(url_for('lecturer_submission_overview'))

    if request.method == 'POST':
        action = request.form.get('action')
        if action in ['Approved', 'Rejected']:
            # Update status
            mongo.db.resubmission_requests.update_one(
                {'_id': resub['_id']},
                {'$set': {'status': action}}
            )

            if action == 'Approved':
                # Replace the filename in submissions
                mongo.db.submissions.update_one(
                    {'_id': ObjectId(resub['submission_id'])},
                    {'$set': {'filename': resub['new_filename']}}
                )

                # Delete the old file
                old_path = os.path.join(app.root_path, 'static', 'uploads', 'submissions', resub['old_filename'])
                if os.path.exists(old_path):
                    os.remove(old_path)

            elif action == 'Rejected':
                pass # No file deletion

            flash(f"Resubmission {action.lower()} successfully.", "success")
        return redirect(url_for('lecturer_view_submissions', assessment_code=resub['assessment_code']))

    # Get student details
    student = mongo.db.users.find_one({'user_id': resub['student_id']})
    return render_template("lec_resubmission_detail.html",
                           resub=resub, 
                           student=student) 

# ============================
# 👨‍🏫 Similarity Detection
# ============================
@app.route('/lecturer/exam/resubmission/<submission_id>/similarity')
def check_similarity(submission_id):
    if 'user_id' not in session or session.get('role') != 'lecturer':
        flash("Unauthorized access.", "danger")
        return redirect(url_for('login'))

    resub = mongo.db.resubmission_requests.find_one({'submission_id': submission_id})
    if not resub:
        flash("Resubmission not found.", "danger")
        return redirect(url_for('lecturer_submission_overview'))

    old_path = os.path.join(app.root_path, 'static', 'uploads', 'submissions', resub['old_filename'])
    new_path = os.path.join(app.root_path, 'static', 'uploads', 'submissions', resub['new_filename'])

    text1 = extract_text(old_path)
    text2 = extract_text(new_path)
    try:
        similarity = calculate_cosine_similarity(text1, text2)
    except Exception as e:
        print("Cosine similarity failed, falling back:", e)
        similarity = calculate_similarity(text1, text2)

    highlighted1, highlighted2 = highlight_matches(text1, text2)

    cosine = calculate_cosine_similarity(text1, text2)
    sequence = calculate_similarity(text1, text2)
    highlighted1, highlighted2 = highlight_matches(text1, text2)

    # Save to DB (update only similarity and timestamp)
    mongo.db.resubmission_requests.update_one(
        {'_id': resub['_id']},
        {'$set': {
            'similarity_score': sequence,
            'similarity_checked_at': datetime.now()
        }}
    )
    
    return render_template("similarity_report.html",
                                resub=resub,
                                similarity=sequence,
                                cosine_score=cosine,
                                original_text=highlighted1,
                                resubmitted_text=highlighted2
                            )

# ============================
# 👨‍🏫 Plagiarism Detection
# ============================

# =======================
# API Token
# =======================
PLAGIARISM_API_TOKEN = "hWimETnNiorz55JhqcoRUWuBDT-MXIOf"

# =======================
# Extract text from .docx
# =======================
def extract_text_from_docx(docx_path):
    try:
        import docx
        doc = docx.Document(docx_path)
        text_content = "\n".join([para.text for para in doc.paragraphs]).strip()
        print(f"DEBUG: Extracted text length: {len(text_content)}")
        print(f"DEBUG: First 200 chars: {text_content[:200]}...")
        return text_content
    except Exception as e:
        print(f"ERROR: Failed to extract text from DOCX: {e}")
        return None

# =======================
# Submit file for plagiarism check
# =======================
def check_plagiarism(file_path):
    import requests
    import os
    url = "https://plagiarismcheck.org/api/v1/text"
    headers = {'X-API-TOKEN': PLAGIARISM_API_TOKEN}
    print(f"DEBUG: Checking file at path: {file_path}")

    if not os.path.exists(file_path):
        print(f"ERROR: File not found: {file_path}")
        return None

    try:
        if file_path.lower().endswith('.docx'):
            print("DEBUG: File is a DOCX. Extracting...")
            text_content = extract_text_from_docx(file_path)
        elif file_path.lower().endswith('.txt'):
            with open(file_path, 'r', encoding='utf-8') as file:
                text_content = file.read().strip()
        else:
            print("ERROR: Unsupported file type.")
            return None

        if not text_content:
            print("ERROR: No text extracted.")
            return None

        # API expects 'text' and optionally 'language' parameters
        data = {
            'text': text_content,
            'language': 'en'
        }
        
        response = requests.post(url, headers=headers, data=data)
        print(f"DEBUG: Response status: {response.status_code}")
        print(f"DEBUG: Response content: {response.text}")

        # API returns 200 or 201 on success
        if response.status_code in (200, 201):
            response_json = response.json()
            # Check for success flag and data structure as per API docs
            if response_json.get('success') and 'data' in response_json:
                text_id = response_json['data']['text']['id']
                print(f"DEBUG: Text ID: {text_id}")
                return text_id
            else:
                print(f"ERROR: API returned success=false or missing data")
                print(f"ERROR: Response: {response_json}")
        else:
            print(f"ERROR: File upload failed. Status: {response.status_code}")
            print(f"ERROR: Response: {response.text}")
    except Exception as e:
        print(f"ERROR: Exception during plagiarism check: {e}")
        import traceback
        traceback.print_exc()
    return None

# =======================
# Check the status of the plagiarism check
# =======================
def check_plagiarism_status(text_id):
    import requests
    import json
    url = f"https://plagiarismcheck.org/api/v1/text/{text_id}"
    headers = {'X-API-TOKEN': PLAGIARISM_API_TOKEN}
    
    try:
        response = requests.get(url, headers=headers)
        
        if response.status_code == 200:
            response_json = response.json()
            print(f"DEBUG: Full response data: {json.dumps(response_json, indent=2)}")
            
            # According to API docs, the state is in data.state
            state = response_json.get('data', {}).get('state')
            print(f"DEBUG: State of text_id {text_id}: {state}")
            return state
        else:
            print(f"ERROR: Status check failed with status {response.status_code}")
            print(f"ERROR: Response: {response.text}")
    except Exception as e:
        print(f"ERROR: Exception during status check: {e}")
        import traceback
        traceback.print_exc()
    return None

# =======================
# Fetch report from API - CORRECTED VERSION
# =======================
def fetch_plagiarism_report(text_id):
    import requests
    import time
    import json
    
    url = f"https://plagiarismcheck.org/api/v1/text/report/{text_id}"
    headers = {'X-API-TOKEN': PLAGIARISM_API_TOKEN}
    max_tries = 30

    for attempt in range(1, max_tries + 1):
        try:
            response = requests.get(url, headers=headers)
            print(f"DEBUG: Poll {attempt}/{max_tries} - Status {response.status_code}")
            
            if response.status_code == 200:
                response_json = response.json()
                print(f"DEBUG: Full API response: {json.dumps(response_json, indent=2)}")
                
                data = response_json.get('data', {})

                # Save 'data' to extracted_data.json for debugging
                with open('extracted_data.json', 'w', encoding='utf-8') as f:
                    json.dump(data, f, indent=2, ensure_ascii=False)
                print("DEBUG: 'data' saved to extracted_data.json")

                # Check if we have report_data (indicates processing is complete)
                report_data = data.get('report_data', {})
                
                if report_data and 'nodes' in report_data:
                    # Report is ready - extract the data
                    nodes = report_data.get('nodes', [])
                    report = data.get('report', {})
                    sources_list = report_data.get('sources', [])

                    # Extract plagiarism percentage from report.percent
                    percent_str = report.get('percent', '0.00')
                    try:
                        plagiarism_percent = float(percent_str)
                        # Ensure we maintain the same precision as the API
                        plagiarism_percent = round(plagiarism_percent, 2)
                    except (ValueError, TypeError):
                        plagiarism_percent = 0.0

                    # Calculate quotes percentage by text length (correct method)
                    quotes_data = report_data.get('quotes', [])
                    total_document_length = report_data.get('length', 1)  # Avoid division by zero
                    
                    # Sum up the length of all quotes
                    total_quote_length = sum(quote.get('length', 0) for quote in quotes_data)
                    
                    quotes_percentage = round((total_quote_length / total_document_length) * 100, 2) if total_document_length > 0 else 0.0

                    # Extract unique sources that were actually matched
                    # Get all unique source IDs from nodes
                    matched_source_ids = set()
                    for node in nodes:
                        if node.get('enabled', True) and node.get('sources', []):
                            matched_source_ids.update(node.get('sources', []))

                    # Build the source list using only matched sources
                    matched_sources = []
                    for source_id in matched_source_ids:
                        if source_id < len(sources_list):
                            source = sources_list[source_id]
                            # Only include sources with actual matches (plagiarism_percent > 0)
                            if source.get('plagiarism_percent', 0) > 0:
                                matched_sources.append({
                                    'source': source.get('source', ''),
                                    'content_type': source.get('content_type', ''),
                                    'plagiarism_percent': source.get('plagiarism_percent', 0),
                                    'plagiarism_length': source.get('plagiarism_length', 0),
                                    'link': source.get('link', {})
                                })

                    print(f"DEBUG: Extracted - Plagiarism: {plagiarism_percent}%, Quotes: {quotes_percentage}%, Sources count: {len(matched_sources)}")
                    
                    return {
                        'plagiarism_score': plagiarism_percent,
                        'quotes_score': quotes_percentage,
                        'sources': matched_sources,
                        'report_data': report_data  # Include the detailed report data
                    }
                else:
                    # Check if we're still processing by looking at text status
                    print("DEBUG: Report data not available yet, checking text status...")
                    status = check_plagiarism_status(text_id)
                    if status == 5:
                        print("DEBUG: Status is 5 but no report_data - possible API delay, retrying...")
                    elif status == 3:
                        print("DEBUG: Still processing...")
                    elif status == 4:
                        print("DEBUG: API reported error state")
                        break
                    else:
                        print(f"DEBUG: Unknown status: {status}")
            
            elif response.status_code == 404:
                print("ERROR: Text ID not found")
                break
            else:
                print(f"ERROR: Report fetch failed with status {response.status_code}")
                print(f"ERROR: Response: {response.text}")

            time.sleep(10)
        except Exception as e:
            print(f"ERROR: During report fetch: {e}")
            import traceback
            traceback.print_exc()
            break

    print("ERROR: Timed out or failed fetching report")
    return None

# =======================
# Flask route - Check plagiarism
# =======================
@app.route('/lecturer/plagiarism/<submission_id>', methods=['POST'])
def check_plagiarism_request(submission_id):
    if 'user_id' not in session or session.get('role') != 'lecturer':
        flash("Unauthorized access.", "danger")
        return redirect(url_for('login'))
    
    try:
        # Fetch submission from the database
        submission = mongo.db.submissions.find_one({'_id': ObjectId(submission_id)})
        if not submission:
            flash("Submission not found.", "danger")
            return redirect(url_for('lecturer_submission_overview'))

        # Construct file path and ensure the file exists
        file_path = os.path.join(app.root_path, 'static', 'uploads', 'submissions', submission['filename'])
        if not os.path.exists(file_path):
            flash("File not found.", "danger")
            return redirect(url_for('lecturer_submission_overview'))

        # Check plagiarism for the file
        text_id = check_plagiarism(file_path)
        if not text_id:
            flash("Plagiarism check failed to submit.", "danger")
            return redirect(url_for('lecturer_submission_overview'))

        # Start fetching the plagiarism report
        flash("Plagiarism check started. Please wait...", "info")
        result = fetch_plagiarism_report(text_id)

        if result:
            plagiarism_score = result['plagiarism_score']
            quotes_score = result['quotes_score']
            sources = result['sources']
            report_data = result.get('report_data', {})  # Get report_data from result
            report_url = f"https://plagiarismcheck.org/profile/check-document-report/{text_id}"

            print(f"DEBUG: Final values - Plagiarism: {plagiarism_score}%, Quotes: {quotes_score}%, Sources: {len(sources)}")

            # Update MongoDB with plagiarism score, quotes score, sources, and report data
            update_data = {
                'plagiarism_score': plagiarism_score,
                'quotes_score': quotes_score,
                'sources': sources,
                'plagiarism_report_url': report_url,
                'plagiarism_text_id': text_id,
                'report_data': report_data  # Store the detailed report data
            }
            
            print(f"DEBUG: Updating MongoDB with: {update_data}")
            
            result_update = mongo.db.submissions.update_one(
                {'_id': ObjectId(submission_id)},
                {'$set': update_data}
            )
            
            if result_update.modified_count > 0:
                flash(f"✅ Plagiarism score: {plagiarism_score}%, Quotes: {quotes_score}%", "success")
            else:
                flash("⚠️ Plagiarism check completed but database update failed.", "warning")
            
            # Get assessment code for redirect
            assessment_code = submission.get('assessment_code')
            return redirect(url_for('lecturer_view_submissions', assessment_code=assessment_code))

        else:
            flash("❌ Failed to fetch plagiarism result.", "danger")

    except Exception as e:
        print(f"ERROR: check_plagiarism_request: {e}")
        import traceback
        traceback.print_exc()
        flash("Internal error during plagiarism check.", "danger")

    return redirect(url_for('lecturer_view_submissions'))

# =======================
# Flask route - View detailed plagiarism report - UNCHANGED
# =======================
@app.route('/lecturer/plagiarism/report/<submission_id>', methods=['GET'])
def lecturer_view_plagiarism_report(submission_id):
    if 'user_id' not in session or session.get('role') != 'lecturer':
        flash("Unauthorized access.", "danger")
        return redirect(url_for('login'))

    # Fetch submission data
    submission = mongo.db.submissions.find_one({'_id': ObjectId(submission_id)})
    if not submission:
        flash("Submission not found.", "danger")
        return redirect(url_for('lecturer_submission_overview'))

    # Fetch student info
    student = mongo.db.users.find_one({'user_id': submission['student_id']})
    if not student:
        flash("Student information not found.", "danger")
        return redirect(url_for('lecturer_submission_overview'))

    # Fetch course info
    course = mongo.db.courses.find_one({'students': submission['student_id']})
    course_name = course.get('course_name') if course else "N/A"

    # Add additional fields to student_info
    student['filename'] = submission.get('filename', '')
    student['course'] = course_name

    # Pass everything to template including detailed report data
    return render_template('lec_plagiarism_report.html',
                           plagiarism_report_url=submission.get('plagiarism_report_url'),
                           student_info=student,
                           plagiarism_score=submission.get('plagiarism_score', 0),
                           quotes_score=submission.get('quotes_score', 0),
                           sources=submission.get('sources', []),
                           report_data=submission.get('report_data', {}))

# ============================
# 👨‍🏫 Exam Violation Management
# ============================
@app.route('/lecturer/exam/violations')
def lecturer_exam_violations():
    if 'user_id' not in session or session.get('role') != 'lecturer':
        flash("Unauthorized access.", "danger")
        return redirect(url_for('login'))

    # Get all violations
    violations = list(mongo.db.exam_violations.find().sort("timestamp", -1))

    for v in violations:
        # Get student name
        student = mongo.db.users.find_one({'user_id': v['student_id']})
        v['student_name'] = student['name'] if student else "Unknown"

        # Find any matching evidence
        evidence = mongo.db.exam_evidence.find_one({
            'assessment_code': v['assessment_code'],
            'student_id': v['student_id'],
            'violation_type': {'$regex': f'^{v["violation_type"]}$', '$options': 'i'},  # Case-insensitive match
            'timestamp': {'$gte': v['timestamp'] - timedelta(seconds=30), '$lte': v['timestamp'] + timedelta(seconds=30)}
        })

        v['evidence'] = evidence if evidence else None

    return render_template("lec_exam_violation.html", violations=violations)



# ============================
# 👨‍🏫 Student Course
# ============================
@app.route('/student/course')
def student_course():
    if 'user_id' not in session or session.get('role') != 'student':
        flash("Unauthorized access.", "danger")
        return redirect(url_for('login'))

    user = mongo.db.users.find_one({'user_id': session['user_id']})
    enrolled_courses = []

    if user and 'user_id' in user:
        enrolled_courses = list(mongo.db.courses.find({'students': user['user_id']}))

    return render_template('student_course.html', courses=enrolled_courses)

# ============================
# 👨‍🏫 Student assessmnet
# ============================
@app.route('/student/assessment', methods=['GET'])
def student_assessment():
    if 'user_id' not in session or session.get('role') != 'student':
        flash("Unauthorized access.", "danger")
        return redirect(url_for('login'))

    user_id = session['user_id']

    # Get all assessments the student is already in
    enrolled = list(mongo.db.assessments.find({'students': user_id}))

    # Get the course_codes the student is in (based on enrolled courses)
    student_courses = set()
    courses = mongo.db.courses.find({'students': user_id})
    for course in courses:
        student_courses.update(course['course_code'] if isinstance(course['course_code'], list) else [course['course_code']])

    # Get assessments under student's courses but where student is NOT yet enrolled
    available = mongo.db.assessments.find({
        'course_codes': {'$in': list(student_courses)},
        'students': {'$ne': user_id}
    })

    return render_template(
        'student_assessment.html',
        enrolled=enrolled,
        available=available
    )

@app.route('/student/assessments/enroll/<code>', methods=['POST'])
def enroll_assessment(code):
    if 'user_id' not in session or session.get('role') != 'student':
        flash("Unauthorized access.", "danger")
        return redirect(url_for('login'))

    user_id = session['user_id']

    mongo.db.assessments.update_one(
        {'assessment_code': code},
        {'$addToSet': {'students': user_id}}  # avoids duplicates
    )
    flash("Successfully enrolled in assessment!", "success")
    return redirect(url_for('student_assessment'))

# ============================
# 👨‍🏫 Student Timetable
# ============================
from flask import render_template, session, redirect, url_for, flash
from datetime import datetime, timedelta

@app.route('/student/exam/timetable')
def student_exam_timetable():
    if 'user_id' not in session or session.get('role') != 'student':
        flash("Unauthorized access.", "danger")
        return redirect(url_for('login'))

    student_id = session['user_id']

    # Step 1: Get all assessments where student is enrolled
    assessments = list(mongo.db.assessments.find({'students': {'$in': [student_id]}}))
    assessment_codes = [a['assessment_code'] for a in assessments]
    assessment_map = {a['assessment_code']: a['title'] for a in assessments}

    # Step 2: Get all exam timetables for those assessments
    exam_timetables = list(mongo.db.exam_timetables.find({
        'assessment_code': {'$in': assessment_codes}
    }))

    # Sort by exam_date and start_time
    exam_timetables.sort(key=lambda x: (
        x['exam_date'],
        x['start_time']
    ))

    # Step 3: Enrich timetable for easier rendering
    for e in exam_timetables:
        e['start_hour'] = int(e['start_time'].split(':')[0])
        e['end_hour'] = int(e['end_time'].split(':')[0]) + (1 if int(e['end_time'].split(':')[1]) > 0 else 0)
        if isinstance(e['exam_date'], datetime):
            e['exam_date'] = e['exam_date'].strftime('%Y-%m-%d')

    # Step 4: Create week range (Mon–Sun)
    today = datetime.today()
    start_week = today - timedelta(days=today.weekday())  # Monday
    days = [start_week + timedelta(days=i) for i in range(7)]

    return render_template(
        'student_exam_timetable.html',
        exam_timetables=exam_timetables,
        assessment_map=assessment_map,
        days=days
    )

@app.template_filter('datetimeformat')
def datetimeformat(value, format='%Y-%m-%d'):
    if isinstance(value, str):
        value = datetime.strptime(value, '%Y-%m-%d')
    return value.strftime(format)

# ============================
# 👨‍🏫 Student Join Exam
# ============================
@app.route('/student/exam/join')
def join_exam():
    if 'user_id' not in session or session.get('role') != 'student':
        flash("Unauthorized access.", "danger")
        return redirect(url_for('login'))

    student_id = session['user_id']

    # Find all assessments the student is enrolled in
    assessments = list(mongo.db.assessments.find({'students': {'$in': [student_id]}}))
    assessment_codes = [a['assessment_code'] for a in assessments]
    assessment_map = {a['assessment_code']: a['title'] for a in assessments}

    # Get relevant exam schedules
    exam_timetables = list(mongo.db.exam_timetables.find({'assessment_code': {'$in': assessment_codes}}))

    # Sort by date + time
    exam_timetables.sort(key=lambda x: (x['exam_date'], x['start_time']))

    # ✅ New: Get list of assessment_codes the student has already submitted
    submitted_codes = mongo.db.submissions.distinct('assessment_code', {'student_id': student_id})

    today = datetime.today().strftime('%Y-%m-%d')
    now = datetime.now().strftime('%H:%M')

    return render_template("join_exam.html",
                           exam_timetables=exam_timetables,
                           assessment_map=assessment_map,
                           submitted_codes=submitted_codes,  # <-- pass to template
                           today=today,
                           now=now)


# ============================
# 👨‍🏫 Student Exam Interface
# ============================
@app.route('/student/exam/<assessment_code>/start')
def student_exam_interface(assessment_code):
    if 'user_id' not in session or session.get('role') != 'student':
        flash("Unauthorized access.", "danger")
        return redirect(url_for('login'))

    student_id = session['user_id']

    # Fetch the assessment
    assessment = mongo.db.assessments.find_one({'assessment_code': assessment_code})
    if not assessment or student_id not in assessment.get('students', []):
        flash("You are not enrolled in this assessment.", "danger")
        return redirect(url_for('student_join_exam'))

    # Fetch timetable
    timetable = mongo.db.exam_timetables.find_one({'assessment_code': assessment_code})
    if not timetable:
        flash("No exam scheduled for this assessment.", "danger")
        return redirect(url_for('student_join_exam'))

    # Timing validation
    now = datetime.now()
    exam_date = datetime.strptime(timetable['exam_date'], '%Y-%m-%d')
    start_time = datetime.strptime(timetable['start_time'], '%H:%M')
    end_time = datetime.strptime(timetable['end_time'], '%H:%M')

    start_dt = datetime.combine(exam_date.date(), start_time.time())
    end_dt = datetime.combine(exam_date.date(), end_time.time())

    if not (start_dt <= now <= end_dt):
        flash("You can only access this exam during the scheduled time.", "danger")
        return redirect(url_for('student_join_exam'))

    return render_template(
        'student_exam_interface.html',
        assessment=assessment,
        timetable=timetable,
        start_time=start_dt.strftime('%Y-%m-%d %H:%M:%S'),
        end_time=end_dt.strftime('%Y-%m-%d %H:%M:%S'),
    )

# ============================
# 👨‍🏫 Student Submit Exam
# ============================
UPLOAD_FOLDER = os.path.join('static', 'uploads', 'submissions')
ALLOWED_EXTENSIONS = {'txt', 'doc', 'docx'}

app.config['UPLOAD_FOLDER'] = UPLOAD_FOLDER

def allowed_file(filename):
    return '.' in filename and \
           filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS

@app.route('/student/exam/<assessment_code>/submit', methods=['POST'])
def submit_exam(assessment_code):
    if 'user_id' not in session or session.get('role') != 'student':
        flash("Unauthorized access.", "danger")
        return redirect(url_for('login'))

    student_id = session['user_id']
    file = request.files.get('submission_files')
    auto_submit = request.form.get('auto_submit') == 'true'
    now_myt = datetime.now()
    filename = ""

    if file and allowed_file(file.filename):
        filename = secure_filename(
            f"{assessment_code}_{student_id}_{now_myt.strftime('%Y%m%d%H%M%S')}_{file.filename}"
        )
        save_path = os.path.join(app.config['UPLOAD_FOLDER'], filename)
        os.makedirs(app.config['UPLOAD_FOLDER'], exist_ok=True)
        file.save(save_path)

    elif auto_submit:
        filename = "No file submitted"

    else:
        errors = {'submission_files': "Invalid file format. Please upload a Txt or DOC/DOCX file."}
        assessment = mongo.db.assessments.find_one({'assessment_code': assessment_code})
        timetable = mongo.db.exam_timetables.find_one({'assessment_code': assessment_code})
        exam_date = datetime.strptime(timetable['exam_date'], '%Y-%m-%d')
        start_time = datetime.strptime(timetable['start_time'], '%H:%M')
        end_time = datetime.strptime(timetable['end_time'], '%H:%M')
        start_dt = datetime.combine(exam_date.date(), start_time.time())
        end_dt = datetime.combine(exam_date.date(), end_time.time())

        return render_template(
            'student_exam_interface.html',
            assessment=assessment,
            timetable=timetable,
            start_time=start_dt.strftime('%Y-%m-%d %H:%M:%S'),
            end_time=end_dt.strftime('%Y-%m-%d %H:%M:%S'),
            errors=errors
        )

    mongo.db.submissions.insert_one({
        "assessment_code": assessment_code,
        "student_id": student_id,
        "filename": filename,
        "submitted_at": now_myt
    })

    flash("Your submission has been uploaded successfully.", "success")
    return redirect(url_for('join_exam'))


# ============================
# 🚨 Screen Monitoring
# ============================
# Evidence folder paths
EVIDENCE_FOLDER = os.path.join('static', 'evidence')
SCREENSHOTS_FOLDER = os.path.join(EVIDENCE_FOLDER, 'screenshots')
VIDEOS_FOLDER = os.path.join(EVIDENCE_FOLDER, 'videos')

# Create evidence folders if they don't exist
os.makedirs(SCREENSHOTS_FOLDER, exist_ok=True)
os.makedirs(VIDEOS_FOLDER, exist_ok=True)
# ============================
# 🚨 API Route: Record Violation
# ============================
@app.route('/api/record_violation', methods=['POST'])
def record_violation():
    """Record a violation in the database"""
    if 'user_id' not in session or session.get('role') != 'student':
        return jsonify({'error': 'Unauthorized'}), 401

    try:
        data = request.get_json()
        
        # Create violation record
        violation_record = {
            'assessment_code': data.get('assessment_code'),
            'student_id': data.get('student_id'),
            'violation_type': data.get('type'),
            'description': data.get('description'),
            'timestamp': datetime.fromisoformat(data.get('timestamp').replace('Z', '+00:00')),
            'count': data.get('count'),
            'created_at': datetime.now()
        }
        
        # Insert into exam_violations collection
        result = mongo.db.exam_violations.insert_one(violation_record)
        
        print(f"✅ Violation recorded: {violation_record['violation_type']} for {violation_record['student_id']}")
        
        return jsonify({
            'status': 'success',
            'violation_id': str(result.inserted_id)
        }), 200
        
    except Exception as e:
        print(f"❌ Error recording violation: {e}")
        return jsonify({'error': 'Failed to record violation'}), 500

# ============================
# 📸 API Route: Upload Evidence (Screenshots & Videos)
# ============================
@app.route('/api/upload_violation_evidence', methods=['POST'])
def upload_violation_evidence():
    """Upload screenshot and video evidence"""
    if 'user_id' not in session or session.get('role') != 'student':
        return jsonify({'error': 'Unauthorized'}), 401

    try:
        assessment_code = request.form.get('assessment_code')
        student_id = request.form.get('student_id')
        violation_type = request.form.get('violation_type')
        timestamp = request.form.get('timestamp')
        
        if not all([assessment_code, student_id, violation_type, timestamp]):
            return jsonify({'error': 'Missing required fields'}), 400

        uploaded_files = []
        
        # Handle screenshot upload
        if 'screenshot' in request.files:
            screenshot = request.files['screenshot']
            if screenshot and screenshot.filename:
                # Create secure filename
                timestamp_str = datetime.now().strftime('%Y%m%d_%H%M%S')
                filename = secure_filename(f"screenshot_{assessment_code}_{student_id}_{timestamp_str}.png")
                filepath = os.path.join(SCREENSHOTS_FOLDER, filename)
                
                # Save screenshot
                screenshot.save(filepath)
                uploaded_files.append({
                    'type': 'screenshot',
                    'filename': filename,
                    'filepath': filepath
                })
                print(f"📷 Screenshot saved: {filename}")

        # Handle video upload
        if 'video' in request.files:
            video = request.files['video']
            if video and video.filename:
                # Create secure filename with proper extension
                timestamp_str = datetime.now().strftime('%Y%m%d_%H%M%S')
                
                # Get file extension from uploaded filename
                original_extension = os.path.splitext(video.filename)[1]
                if not original_extension:
                    original_extension = '.mp4'  # Default to MP4
                
                filename = secure_filename(f"video_{assessment_code}_{student_id}_{timestamp_str}{original_extension}")
                filepath = os.path.join(VIDEOS_FOLDER, filename)
                
                # Save video
                video.save(filepath)
                uploaded_files.append({
                    'type': 'video',
                    'filename': filename,
                    'filepath': filepath
                })
                print(f"🎥 Video saved: {filename} ({original_extension})")

        # Create evidence record in database
        if uploaded_files:
            evidence_record = {
                'assessment_code': assessment_code,
                'student_id': student_id,
                'violation_type': violation_type,
                'timestamp': datetime.fromisoformat(timestamp.replace('Z', '+00:00')),
                'files': uploaded_files,
                'uploaded_at': datetime.now()
            }
            
            # Insert into exam_evidence collection
            result = mongo.db.exam_evidence.insert_one(evidence_record)
            
            return jsonify({
                'status': 'success',
                'evidence_id': str(result.inserted_id),
                'files_uploaded': len(uploaded_files)
            }), 200
        else:
            return jsonify({'error': 'No files uploaded'}), 400
            
    except Exception as e:
        print(f"❌ Error uploading evidence: {e}")
        return jsonify({'error': 'Failed to upload evidence'}), 500


# ============================
# 👨‍🏫 Student My Submission
# ============================
@app.route('/student/submissions')
def student_submissions():
    if 'user_id' not in session or session.get('role') != 'student':
        flash("Unauthorized access.", "danger")
        return redirect(url_for('login'))

    student_id = session['user_id']
    submissions = list(mongo.db.submissions.find({'student_id': student_id}).sort('submitted_at', -1))

    malaysia = timezone('Asia/Kuala_Lumpur')
    now = datetime.now(malaysia)

    # Fetch status from resubmission_requests
    requests = mongo.db.resubmission_requests.find({'student_id': student_id})
    status_map = {str(r['submission_id']): r['status'] for r in requests}

    for s in submissions:
        if isinstance(s['submitted_at'], datetime):
            s['submitted_at'] = s['submitted_at'].astimezone(malaysia)
            s['can_request_resubmission'] = now - s['submitted_at'] <= timedelta(hours=24)
        else:
            s['can_request_resubmission'] = False
        s['status'] = status_map.get(str(s['_id']), None)

    assessment_codes = list({s['assessment_code'] for s in submissions})
    assessments = mongo.db.assessments.find({'assessment_code': {'$in': assessment_codes}})
    assessment_map = {a['assessment_code']: a['title'] for a in assessments}

    return render_template("student_submission.html",
                           submissions=submissions,
                           assessment_map=assessment_map)


# ============================
# 👨‍🏫 Student Request Resubmit
# ============================
@app.route('/student/request-resubmission/<submission_id>', methods=['GET', 'POST'])
def student_request_resubmission(submission_id):
    if 'user_id' not in session or session.get('role') != 'student':
        flash("Unauthorized access.", "danger")
        return redirect(url_for('login'))

    # Get submission
    submission = mongo.db.submissions.find_one({'_id': ObjectId(submission_id)})
    if not submission:
        flash("Submission not found.", "danger")
        return redirect(url_for('student_submissions'))

    student = mongo.db.users.find_one({'user_id': submission['student_id']})
    if not student:
        flash("Student details not found.", "danger")
        return redirect(url_for('student_submissions'))

    # Get course name (via assessment ➝ course_codes[0] ➝ course_name)
    assessment = mongo.db.assessments.find_one({'assessment_code': submission['assessment_code']})
    course_name = ""
    if assessment and assessment.get('course_codes'):
        course = mongo.db.courses.find_one({'course_code': assessment['course_codes'][0]})
        if course:
            course_name = course['course_name']

    # Handle form submission
    if request.method == 'POST':
        new_file = request.files.get('new_file')
        reason = request.form.get('reason')

        if not new_file or new_file.filename == "":
            flash("You must upload a file for resubmission.", "danger")
            return redirect(request.url)

        if not allowed_file(new_file.filename):
            flash("Invalid file format. Upload TXT or DOC/DOCX.", "danger")
            return redirect(request.url)

        filename = secure_filename(f"{submission['assessment_code']}_{student['user_id']}_resub_{datetime.now().strftime('%Y%m%d%H%M%S')}_{new_file.filename}")
        save_path = os.path.join(app.config['UPLOAD_FOLDER'], filename)
        new_file.save(save_path)

        mongo.db.resubmission_requests.insert_one({
            "submission_id": submission_id,
            "student_id": student['user_id'],
            "assessment_code": submission['assessment_code'],
            "old_filename": submission['filename'],
            "submitted_at": submission['submitted_at'],
            "new_filename": filename,
            "reason": reason,
            "status": "Pending",
            "requested_at": datetime.now()
        })

        flash("Resubmission request sent successfully.", "success")
        return redirect(url_for('student_submissions'))

    return render_template('student_request_resubmission.html',
                           student=student,
                           submission=submission,
                           course_name=course_name)




# ============================
# 🚪 Logout
# ============================
@app.route('/logout')
def logout():
    session.clear()
    flash('You have been logged out.', 'info')
    return redirect(url_for('login'))

# Run the Flask app
if __name__ == '__main__':
    app.run(debug=True)
