import cv2
import cvzone
import math
from ultralytics import YOLO
import time
import threading
from flask import Flask, render_template, Response, jsonify, request
import uuid # Para generar IDs únicos para las alarmas
from datetime import datetime # Para timestamps más legibles
import numpy as np # Necesario para el cálculo de brillo

# --- Opcional: Para sonido de alarma ---
# ... (tu código de sonido de alarma) ...

# --- Configuración ---
VIDEO_PATH = 'pruebas3/videos/fire.mp4' # Asegúrate que este video tenga escenarios para probar
YOLO_PERSON_MODEL_PATH = 'yolov8s.pt'
CLASSES_PERSON_FILE_PATH = 'classes.txt'
YOLO_FIRE_MODEL_PATH = 'fire_model.pt'
CLASSES_FIRE_FILE_PATH = 'classes_fire.txt'

FRAME_PROCESS_WIDTH = 640
FRAME_PROCESS_HEIGHT = 480

MIN_CONFIDENCE_PERSON = 0.60
MIN_CONFIDENCE_FIRE = 0.40 # Puedes ajustar esto si tu modelo de fuego es ruidoso

ASPECT_RATIO_THRESHOLD = 0.8
MIN_FALL_DURATION_SEC = 2.0
ALARM_COOLDOWN_SEC_FALL = 30
# ALARM_COOLDOWN_SEC_FIRE = 60 # Cooldown para fuego simple (si aún lo usas)
ALARM_COOLDOWN_SEC_UNATTENDED_FIRE = 20 # Cooldown para fuego desatendido (más corto para pruebas)

# --- Configuración Detección Fuego Desatendido ---
FIRE_UNATTENDED_DURATION_SEC = 10.0 # Fuego + Sin persona durante 10s para alarma

# --- Configuración Detección de Luz Olvidada (MODO TEST) ---
LIGHT_CHECK_INTERVAL_SEC = 1.0
LIGHT_ON_NO_PERSON_DURATION_ALARM_SEC = 1.0 # Alarma si luz ON > 1s (sin importar personas en modo test)
LIGHT_ALARM_COOLDOWN_SEC = 10 # Cooldown corto para alarma de luz para pruebas
LIGHT_BRIGHTNESS_THRESHOLD_ON = 110
LIGHT_BRIGHTNESS_THRESHOLD_OFF = 90
HOUR_START_LIGHT_CHECK = 0
HOUR_END_LIGHT_CHECK = 24
# --- FIN Configuración Luz ---

# --- Estado Global Compartido ---
lock = threading.Lock()
output_frame = None
general_status_text_shared = "Estado: Inicializando..."
general_status_class_shared = "status-normal"
stop_processing_flag = threading.Event()

active_alarms_shared = []
last_fall_alarm_time = 0
# last_fire_alarm_time = 0 # Para fuego simple
last_unattended_fire_alarm_time = 0
last_light_alarm_time = 0

# --- Inicialización de Flask ---
app = Flask(__name__)

# --- Carga de Modelos y Clases ---
model_person = None
classnames_person = []
model_fire = None
classnames_fire = []

try:
    model_person = YOLO(YOLO_PERSON_MODEL_PATH)
    with open(CLASSES_PERSON_FILE_PATH, 'r') as f:
        classnames_person = f.read().splitlines()
    print(f"Modelo de detección de personas '{YOLO_PERSON_MODEL_PATH}' y clases cargados.")
except Exception as e:
    print(f"Error al cargar modelo de personas o clases: {e}")

try:
    model_fire = YOLO(YOLO_FIRE_MODEL_PATH)
    with open(CLASSES_FIRE_FILE_PATH, 'r') as f:
        classnames_fire = f.read().splitlines()
    print(f"Modelo de detección de fuego '{YOLO_FIRE_MODEL_PATH}' y clases cargados.")
except Exception as e:
    print(f"Error al cargar modelo de fuego o clases: {e}")


def create_new_alarm(alarm_type="caida"):
    global active_alarms_shared, last_fall_alarm_time, last_unattended_fire_alarm_time, last_light_alarm_time, lock
    current_time = time.time()

    if alarm_type == "caida":
        if current_time - last_fall_alarm_time < ALARM_COOLDOWN_SEC_FALL:
            return None
        last_fall_alarm_time = current_time
    elif alarm_type == "fuego_desatendido": # Nuevo tipo
        if current_time - last_unattended_fire_alarm_time < ALARM_COOLDOWN_SEC_UNATTENDED_FIRE:
            return None
        last_unattended_fire_alarm_time = current_time
    # elif alarm_type == "fuego": # Si aún quieres la alarma de fuego simple
    #     if current_time - last_fire_alarm_time < ALARM_COOLDOWN_SEC_FIRE:
    #         return None
    #     last_fire_alarm_time = current_time
    elif alarm_type == "luz_olvidada":
        if current_time - last_light_alarm_time < LIGHT_ALARM_COOLDOWN_SEC:
            return None
        last_light_alarm_time = current_time

    alarm_id = str(uuid.uuid4())
    timestamp = datetime.now()
    new_alarm = {
        'id': alarm_id,
        'type': alarm_type,
        'timestamp_detected': timestamp.isoformat(),
        'status': 'new',
        'last_status_change': timestamp.isoformat(),
        'snapshot_path': None
    }
    with lock:
        active_alarms_shared.append(new_alarm)
        print(f"NUEVA ALARMA GENERADA: ID={alarm_id}, Tipo={alarm_type}, Hora={timestamp.strftime('%Y-%m-%d %H:%M:%S')}")
    return new_alarm


def video_processing():
    global output_frame, general_status_text_shared, general_status_class_shared, lock, active_alarms_shared

    cap = cv2.VideoCapture(VIDEO_PATH)
    if not cap.isOpened():
        # ... (manejo de error de cámara no cambia) ...
        print(f"Error: No se pudo abrir el video/cámara en '{VIDEO_PATH}'")
        with lock:
            general_status_text_shared = "Error: No se pudo abrir la cámara/video."
            general_status_class_shared = "status-alarm-active"
        return

    print("Procesamiento de vídeo iniciado...")
    person_potentially_fallen_since = None

    # Para detección de luz (modo test)
    last_light_check_time = 0.0
    light_is_on_state = False
    light_on_no_person_start_time = None

    # Para detección de fuego desatendido
    fire_detected_continuously_since = None
    last_person_seen_timestamp = time.time() # Inicializar a ahora, se actualizará
    potential_unattended_fire_alerted_this_cycle = False # Para evitar alarmas repetidas por el mismo evento antes del cooldown global

    while not stop_processing_flag.is_set():
        ret, frame = cap.read()
        if not ret:
            # ... (manejo de fin de video no cambia) ...
            print("Fin del video o error al leer frame. Reiniciando vídeo si es un archivo.")
            if isinstance(VIDEO_PATH, str) and VIDEO_PATH != '0' and VIDEO_PATH != 0:
                cap.set(cv2.CAP_PROP_POS_FRAMES, 0)
                continue
            else:
                break

        current_processing_time = time.time()
        frame = cv2.resize(frame, (FRAME_PROCESS_WIDTH, FRAME_PROCESS_HEIGHT))
        processed_frame_for_display = frame.copy()

        fall_candidate_this_frame = False
        yolo_found_person_this_frame = False
        yolo_found_fire_this_frame = False # Para la lógica de fuego desatendido

        # --- Detección de Personas y Caídas ---
        if model_person and classnames_person:
            results_person = model_person(frame, verbose=False, conf=MIN_CONFIDENCE_PERSON)
            for info in results_person:
                parameters = info.boxes
                for box in parameters:
                    x1_p, y1_p, x2_p, y2_p = box.xyxy[0]
                    x1_p, y1_p, x2_p, y2_p = int(x1_p), int(y1_p), int(x2_p), int(y2_p)
                    confidence_p = box.conf[0]
                    class_detect_idx_p = int(box.cls[0])
                    if class_detect_idx_p < len(classnames_person):
                        class_name_p = classnames_person[class_detect_idx_p]
                        if class_name_p == 'person':
                            yolo_found_person_this_frame = True
                            last_person_seen_timestamp = current_processing_time # Actualizar cuándo se vio una persona
                            
                            height_p = y2_p - y1_p
                            width_p = x2_p - x1_p
                            cvzone.cornerRect(processed_frame_for_display, [x1_p, y1_p, width_p, height_p], l=20, rt=4,
                                              colorR=(0, 255, 0), colorC=(0, 255, 0))
                            cvzone.putTextRect(processed_frame_for_display, f'Persona {math.ceil(confidence_p * 100)}%',
                                               [x1_p + 5, y1_p - 10], thickness=1, scale=1, colorR=(0, 255, 0))
                            aspect_ratio_p = height_p / width_p if width_p > 0 else float('inf')
                            if aspect_ratio_p < ASPECT_RATIO_THRESHOLD:
                                fall_candidate_this_frame = True
                                if person_potentially_fallen_since is None:
                                    person_potentially_fallen_since = current_processing_time
                                else:
                                    duration_fallen = current_processing_time - person_potentially_fallen_since
                                    cvzone.putTextRect(processed_frame_for_display, f'Posible caida: {duration_fallen:.1f}s',
                                                       [x1_p, y2_p + 15], scale=1, thickness=1, colorR=(50,50,255), offset=3)
                                    if duration_fallen > MIN_FALL_DURATION_SEC:
                                        if create_new_alarm(alarm_type="caida"):
                                            person_potentially_fallen_since = None # Reset para evitar múltiples alarmas
        if not fall_candidate_this_frame and person_potentially_fallen_since is not None:
            person_potentially_fallen_since = None


        # --- Detección de Fuego (con lógica de fuego desatendido) ---
        if model_fire and classnames_fire:
            results_fire = model_fire(frame, verbose=False, conf=MIN_CONFIDENCE_FIRE)
            temp_fire_detected_in_current_model_run = False
            for info in results_fire:
                boxes = info.boxes
                for box in boxes:
                    confidence_f = box.conf[0]
                    Class_f = int(box.cls[0])
                    if Class_f < len(classnames_fire):
                        class_name_fire = classnames_fire[Class_f]
                        if class_name_fire == 'fire': # O la clase específica de tu modelo
                            yolo_found_fire_this_frame = True # Fuego detectado por YOLO este frame
                            temp_fire_detected_in_current_model_run = True
                            x1_f, y1_f, x2_f, y2_f = box.xyxy[0]
                            x1_f, y1_f, x2_f, y2_f = int(x1_f), int(y1_f), int(x2_f), int(y2_f)
                            cv2.rectangle(processed_frame_for_display, (x1_f, y1_f), (x2_f, y2_f), (0, 0, 255), 3)
                            cvzone.putTextRect(processed_frame_for_display, f'FUEGO {math.ceil(confidence_f * 100)}%',
                                               [x1_f + 8, y1_f - 10 if y1_f > 20 else y1_f + 25],
                                               scale=1.2, thickness=2, colorR=(0,0,255), colorT=(255,255,255))
                            # No generar alarma de fuego simple aquí, lo haremos con la lógica desatendida
                            break # Solo necesitamos una detección de fuego para la lógica
                if temp_fire_detected_in_current_model_run:
                    break
            
            if yolo_found_fire_this_frame:
                if fire_detected_continuously_since is None:
                    fire_detected_continuously_since = current_processing_time
                    potential_unattended_fire_alerted_this_cycle = False # Reset al iniciar nueva detección de fuego
                    print(f"DEBUG FUEGO: Fuego detectado. Iniciando contador. Persona presente: {yolo_found_person_this_frame}")
                
                # Lógica de fuego desatendido
                time_since_last_person = current_processing_time - last_person_seen_timestamp
                fire_duration = current_processing_time - fire_detected_continuously_since

                # Visualización de contadores (opcional)
                cvzone.putTextRect(processed_frame_for_display, f"Fuego: {fire_duration:.1f}s", [10,30], scale=1, thickness=1, offset=3)
                cvzone.putTextRect(processed_frame_for_display, f"Sin Persona: {time_since_last_person:.1f}s", [10,60], scale=1, thickness=1, offset=3)

                if not yolo_found_person_this_frame: # Si NO hay persona AHORA
                    if fire_duration >= FIRE_UNATTENDED_DURATION_SEC and \
                       time_since_last_person >= FIRE_UNATTENDED_DURATION_SEC and \
                       not potential_unattended_fire_alerted_this_cycle:
                        print(f"DEBUG FUEGO: ¡CONDICIÓN DE ALARMA FUEGO DESATENDIDO! Fuego por {fire_duration:.1f}s, Sin persona por {time_since_last_person:.1f}s.")
                        if create_new_alarm(alarm_type="fuego_desatendido"):
                            potential_unattended_fire_alerted_this_cycle = True # Marcar que se alertó para este ciclo de detección continua
                            # No resetear fire_detected_continuously_since aquí, el cooldown global lo maneja
                else: # Si HAY persona AHORA
                    potential_unattended_fire_alerted_this_cycle = False # Si vuelve una persona, se puede volver a alertar si se va de nuevo
                    # last_person_seen_timestamp ya se actualiza en la detección de personas

            else: # No se detectó fuego en este frame
                if fire_detected_continuously_since is not None:
                    print(f"DEBUG FUEGO: Fuego ya no detectado. Reseteando contador de fuego.")
                fire_detected_continuously_since = None
                potential_unattended_fire_alerted_this_cycle = False

        # --- Detección de Luz (Modo Test) ---
        if current_processing_time - last_light_check_time >= LIGHT_CHECK_INTERVAL_SEC:
            last_light_check_time = current_processing_time
            current_system_hour = datetime.now().hour

            if HOUR_START_LIGHT_CHECK <= current_system_hour < HOUR_END_LIGHT_CHECK:
                gray_frame_for_light = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
                current_brightness = np.mean(gray_frame_for_light)

                if not light_is_on_state and current_brightness > LIGHT_BRIGHTNESS_THRESHOLD_ON:
                    light_is_on_state = True
                elif light_is_on_state and current_brightness < LIGHT_BRIGHTNESS_THRESHOLD_OFF:
                    light_is_on_state = False
                    light_on_no_person_start_time = None

                if light_is_on_state: # En modo test, alarma casi inmediata si luz ON
                    if light_on_no_person_start_time is None:
                        light_on_no_person_start_time = current_processing_time
                    
                    if (current_processing_time - light_on_no_person_start_time) >= LIGHT_ON_NO_PERSON_DURATION_ALARM_SEC:
                        if create_new_alarm(alarm_type="luz_olvidada"):
                            light_on_no_person_start_time = None # Reset para cooldown
            else:
                light_is_on_state = False
                light_on_no_person_start_time = None
        # --- FIN Detección Luz ---

        # Actualizar estado general y visualización del frame
        with lock:
            active_new_alarms = [a for a in active_alarms_shared if a['status'] == 'new']
            active_acknowledged_alarms = [a for a in active_alarms_shared if a['status'] == 'acknowledged']

            is_new_unattended_fire_alarm = any(a['type'] == 'fuego_desatendido' and a['status'] == 'new' for a in active_new_alarms)
            is_new_fall_alarm = any(a['type'] == 'caida' and a['status'] == 'new' for a in active_new_alarms)
            is_new_light_alarm = any(a['type'] == 'luz_olvidada' and a['status'] == 'new' for a in active_new_alarms)

            # Prioridad a fuego desatendido
            if is_new_unattended_fire_alarm:
                general_status_text_shared = f"¡ALARMA FUEGO DESATENDIDO ({len([a for a in active_new_alarms if a['type']=='fuego_desatendido'])})!"
                general_status_class_shared = "status-alarm-critical"
                if int(current_processing_time * 4) % 2 == 0:
                     overlay = processed_frame_for_display.copy()
                     cv2.rectangle(overlay, (0,0), (FRAME_PROCESS_WIDTH, FRAME_PROCESS_HEIGHT), (0,0,150), -1) # Rojo oscuro
                     cv2.addWeighted(overlay, 0.7, processed_frame_for_display, 0.3, 0, processed_frame_for_display)
            elif is_new_fall_alarm:
                general_status_text_shared = f"¡ALARMA DE CAÍDA ({len([a for a in active_new_alarms if a['type']=='caida'])})!"
                general_status_class_shared = "status-alarm-active"
                if int(current_processing_time * 2) % 2 == 0:
                     overlay = processed_frame_for_display.copy()
                     cv2.rectangle(overlay, (0,0), (FRAME_PROCESS_WIDTH, FRAME_PROCESS_HEIGHT), (0,0,100), -1)
                     cv2.addWeighted(overlay, 0.6, processed_frame_for_display, 0.4, 0, processed_frame_for_display)
            elif is_new_light_alarm:
                general_status_text_shared = f"¡ALARMA LUZ ({len([a for a in active_new_alarms if a['type']=='luz_olvidada'])})!"
                general_status_class_shared = "status-alarm-active" # Podría ser otra clase si quieres diferenciar
                if int(current_processing_time * 1.5) % 2 == 0:
                     overlay = processed_frame_for_display.copy()
                     cv2.rectangle(overlay, (0,0), (FRAME_PROCESS_WIDTH, FRAME_PROCESS_HEIGHT), (0,150,150), -1) # Tipo Cyan
                     cv2.addWeighted(overlay, 0.3, processed_frame_for_display, 0.7, 0, processed_frame_for_display)
            elif active_acknowledged_alarms:
                ack_types = [a['type'] for a in active_acknowledged_alarms]
                status_parts = []
                if 'fuego_desatendido' in ack_types: status_parts.append(f"FuegoDes Rec. ({ack_types.count('fuego_desatendido')})")
                if 'caida' in ack_types: status_parts.append(f"Caída Rec. ({ack_types.count('caida')})")
                if 'luz_olvidada' in ack_types: status_parts.append(f"Luz Rec. ({ack_types.count('luz_olvidada')})")
                
                general_status_text_shared = "Reconocido: " + ", ".join(status_parts) + ". Pendiente."
                general_status_class_shared = "status-possible-fall" # Naranja
            
            elif person_potentially_fallen_since is not None:
                duration_display = current_processing_time - person_potentially_fallen_since
                general_status_text_shared = f"Posible Caida detectada ({duration_display:.1f}s)"
                general_status_class_shared = "status-possible-fall"
            
            elif fire_detected_continuously_since is not None: # Si hay fuego pero aún no es alarma desatendida
                fire_dur = current_processing_time - fire_detected_continuously_since
                person_status = "Presente" if yolo_found_person_this_frame else f"Ausente por {(current_processing_time - last_person_seen_timestamp):.0f}s"
                general_status_text_shared = f"Fuego detectado ({fire_dur:.0f}s). Persona: {person_status}"
                general_status_class_shared = "status-possible-fall" # Naranja para indicar posible riesgo
            
            else:
                general_status_text_shared = "Normal"
                general_status_class_shared = "status-normal"
                if light_is_on_state and HOUR_START_LIGHT_CHECK <= datetime.now().hour < HOUR_END_LIGHT_CHECK and LIGHT_ON_NO_PERSON_DURATION_ALARM_SEC == 1.0: # Modo test luz
                    general_status_text_shared = "Normal (Modo Test Luz ON)"

            ret_jpeg, buffer = cv2.imencode('.jpg', processed_frame_for_display)
            if ret_jpeg:
                output_frame = buffer.tobytes()

    cap.release()
    print("Procesamiento de vídeo detenido.")
    with lock:
        general_status_text_shared = "Procesamiento detenido."
        general_status_class_shared = "status-normal"
        output_frame = None

# --- generate_frames y las rutas Flask ---
# (COPIA EL RESTO DE TU CÓDIGO FLASK AQUÍ, ASEGURÁNDOTE DE QUE `index.html`
#  Y LA RUTA `get_status_and_alarms` PUEDAN MOSTRAR EL NUEVO TIPO "fuego_desatendido"
#  CORRECTAMENTE. La función `sort_key` en `get_status_and_alarms` ya debería ser
#  flexible para nuevos tipos si se añade a `type_order`).
def generate_frames():
    global output_frame, lock
    while True:
        time.sleep(0.03) 
        with lock:
            if output_frame is None:
                blank_frame = np.zeros((FRAME_PROCESS_HEIGHT, FRAME_PROCESS_WIDTH, 3), dtype=np.uint8)
                placeholder = cv2.imread("placeholder.jpg")
                if placeholder is not None:
                    try:
                        blank_frame = cv2.resize(placeholder, (FRAME_PROCESS_WIDTH, FRAME_PROCESS_HEIGHT))
                    except Exception: 
                         cv2.putText(blank_frame, "Sin Senal", (50, FRAME_PROCESS_HEIGHT // 2), cv2.FONT_HERSHEY_SIMPLEX, 1, (255, 255, 255), 2)
                else:
                    cv2.putText(blank_frame, "Sin Senal", (50, FRAME_PROCESS_HEIGHT // 2), cv2.FONT_HERSHEY_SIMPLEX, 1, (255, 255, 255), 2)
                ret_jpeg, buffer = cv2.imencode('.jpg', blank_frame)
                if not ret_jpeg: continue
                frame_bytes = buffer.tobytes()
            else:
                frame_bytes = output_frame
        yield (b'--frame\r\n'
               b'Content-Type: image/jpeg\r\n\r\n' + frame_bytes + b'\r\n')

@app.route('/')
def index():
    return render_template('index.html') # Asegúrate que index.html pueda manejar el nuevo tipo

@app.route('/video_feed')
def video_feed():
    return Response(generate_frames(),
                    mimetype='multipart/x-mixed-replace; boundary=frame')

@app.route('/get_status_and_alarms')
def get_status_and_alarms():
    global general_status_text_shared, general_status_class_shared, active_alarms_shared, lock
    with lock:
        def sort_key(alarm):
            status_order = {'new': 0, 'acknowledged': 1}
            # Añadir fuego_desatendido con alta prioridad
            type_order = {'fuego_desatendido': 0, 'fuego': 1, 'caida': 2, 'luz_olvidada': 3} 
            return (status_order.get(alarm['status'], 99), 
                    type_order.get(alarm['type'], 99),
                    alarm['timestamp_detected']) # Más reciente primero dentro de la misma categoría
        alarms_to_display = sorted(
            [a for a in active_alarms_shared if a['status'] != 'resolved' and a['status'] != 'false_positive'],
            key=sort_key 
        )
        return jsonify({
            "general_status_text": general_status_text_shared,
            "general_status_class": general_status_class_shared,
            "alarms": alarms_to_display
        })

@app.route('/manage_alarm/<alarm_id>/<action>', methods=['POST'])
def manage_alarm_route(alarm_id, action):
    global active_alarms_shared, lock 
    message = "Acción no reconocida o alarma no encontrada."
    success = False
    with lock:
        alarm_found = None
        for alarm in active_alarms_shared:
            if alarm['id'] == alarm_id:
                alarm_found = alarm
                break
        if alarm_found:
            current_time_iso = datetime.now().isoformat()
            alarm_type_display = alarm_found['type'].replace('_', ' ').title()

            if action == 'acknowledge' and alarm_found['status'] == 'new':
                alarm_found['status'] = 'acknowledged'
                alarm_found['last_status_change'] = current_time_iso
                message = f"Alarma {alarm_id[:8]} ({alarm_type_display}) reconocida."
                success = True
            elif action == 'resolve' and alarm_found['status'] == 'acknowledged':
                alarm_found['status'] = 'resolved'
                alarm_found['last_status_change'] = current_time_iso
                message = f"Alarma {alarm_id[:8]} ({alarm_type_display}) resuelta."
                success = True
            elif action == 'false_positive' and (alarm_found['status'] == 'new' or alarm_found['status'] == 'acknowledged'):
                alarm_found['status'] = 'false_positive'
                alarm_found['last_status_change'] = current_time_iso
                message = f"Alarma {alarm_id[:8]} ({alarm_type_display}) marcada como Falso Positivo."
                success = True
            else:
                message = f"No se puede '{action}' la alarma {alarm_id[:8]} ({alarm_type_display}) en estado '{alarm_found['status']}'."
            print(message)
        else:
            message = f"Alarma con ID {alarm_id} no encontrada."
    return jsonify({"message": message, "success": success})

if __name__ == '__main__':
    if not model_person or not classnames_person:
        print("ADVERTENCIA: Modelo de PERSONAS no cargado. Detección de caídas y presencia no funcionará.")
    if not model_fire or not classnames_fire:
        print("ADVERTENCIA: Modelo de FUEGO no cargado. Detección de fuego no funcionará.")
    
    if (not model_person or not classnames_person) and (not model_fire or not classnames_fire):
        print("ERROR CRÍTICO: Ningún modelo pudo ser cargado. La aplicación no se iniciará.")
    else:
        video_thread = threading.Thread(target=video_processing, daemon=True)
        video_thread.start()
        print("Iniciando servidor Flask en http://127.0.0.1:5001")
        app.run(host='0.0.0.0', port=5001, debug=True, threaded=True, use_reloader=False) # debug=False es mejor para producción
        
        print("Deteniendo procesamiento de vídeo...")
        stop_processing_flag.set()
        if video_thread.is_alive():
            video_thread.join(timeout=5)
        print("Aplicación cerrada.")