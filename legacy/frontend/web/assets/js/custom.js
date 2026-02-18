(function ($) {

	'use strict';
	// Mean Menu
	// Mean Menu
	if ($.fn.meanmenu) {
		$('.mean-menu').meanmenu({
			meanScreenWidth: "991"
		});
	}

	// Sticky, Go To Top JS
	$(window).on('scroll', function () {
		// Header Sticky JS
		if ($(this).scrollTop() > 150) {
			$('.navbar-area').addClass("is-sticky");
		}
		else {
			$('.navbar-area').removeClass("is-sticky");
		};

		// Go To Top JS
		var scrolled = $(window).scrollTop();
		if (scrolled > 300) $('.go-top').addClass('active');
		if (scrolled < 300) $('.go-top').removeClass('active');
	});

	// Click Event JS
	$('.go-top').on('click', function () {
		$("html, body").animate({ scrollTop: "0" }, 50);
	});

	// Count Time JS
	function makeTimer() {
		var endTime = new Date("november  30, 2026 17:00:00 PDT");
		var endTime = (Date.parse(endTime)) / 1000;
		var now = new Date();
		var now = (Date.parse(now) / 1000);
		var timeLeft = endTime - now;
		var days = Math.floor(timeLeft / 86400);
		var hours = Math.floor((timeLeft - (days * 86400)) / 3600);
		var minutes = Math.floor((timeLeft - (days * 86400) - (hours * 3600)) / 60);
		var seconds = Math.floor((timeLeft - (days * 86400) - (hours * 3600) - (minutes * 60)));
		if (hours < "10") { hours = "0" + hours; }
		if (minutes < "10") { minutes = "0" + minutes; }
		if (seconds < "10") { seconds = "0" + seconds; }
		$("#days").html(days + "<span>Day</span>");
		$("#hours").html(hours + "<span>Hours</span>");
		$("#minutes").html(minutes + "<span>Minutes</span>");
		$("#seconds").html(seconds + "<span>Seconds</span>");

		$("#dayss").html(days + "<span>d</span>");
		$("#hourss").html(hours + "<span>h</span>");
		$("#minutess").html(minutes + "<span>m</span>");
		$("#secondss").html(seconds + "<span>s</span>");
	}
	setInterval(function () { makeTimer(); }, 300);

	// Preloader
	$(window).on('load', function () {
		$('.preloader').addClass('preloader-deactivate');
	})

	// Others Option For Responsive JS
	$(".others-option-for-responsive .dot-menu").on("click", function () {
		$(".others-option-for-responsive .container .container").toggleClass("active");
	});

	// Partner Slide JS
	$('.partner-slide').owlCarousel({
		loop: true,
		margin: 30,
		nav: false,
		dots: false,
		autoplay: true,
		smartSpeed: 1000,
		autoplayHoverPause: true,
		responsive: {
			0: {
				items: 2,
			},
			414: {
				items: 2,
			},
			576: {
				items: 3,
			},
			768: {
				items: 4,
			},
			992: {
				items: 5,
			},
			1200: {
				items: 5,
			},
		},
	});


	// Customers Slide JS
	$('.customers-slide').owlCarousel({
		items: 1,
		loop: true,
		margin: 24,
		nav: false,
		dots: true,
		autoplay: true,
		smartSpeed: 1000,
		autoplayHoverPause: true,
		center: true,
	});

	// Blog Slide JS
	$('.blog-slide').owlCarousel({
		items: 1,
		loop: true,
		margin: 24,
		nav: true,
		dots: false,
		autoplay: true,
		smartSpeed: 1000,
		autoplayHoverPause: true,
		navText: [
			"<i class='ri-arrow-left-line'></i>",
			"<i class='ri-arrow-right-line'></i>",
		],
		responsive: {
			0: {
				items: 1,
			},
			576: {
				items: 1,
			},
			768: {
				items: 2,
			},
			992: {
				items: 3,
			},
			1200: {
				items: 3,
			},
		},
	});

	// WOW Animation
	if ($('.wow').length) {
		var wow = new WOW({
			boxClass: 'wow',
			animateClass: 'animated',
			offset: 0,
			mobile: false,
			live: true,
		});
		wow.init();
	}

	// Odometer JS
	$('.odometer').appear(function (e) {
		var odo = $(".odometer");
		odo.each(function () {
			var countNumber = $(this).attr("data-count");
			$(this).html(countNumber);
		});
	});

	// FAQ Accordion JS
	$('.accordion').find('.accordion-title').on('click', function () {
		$(this).toggleClass('active');
		$(this).next().slideToggle('fast');
		$('.accordion-content').not($(this).next()).slideUp('fast');
		$('.accordion-title').not($(this)).removeClass('active');
	});

})(jQuery);

//-----------------------------------------------------------------------
// Global Session Expiration Handler
//-----------------------------------------------------------------------
(function () {
	// Definir el HTML del modal de sesión expirada
	// Usamos clases estándar de Bootstrap 5 y estilos compatibles con el tema web
	const sessionExpiredModalHTML = `
    <div class="modal fade" id="sessionExpiredModal" tabindex="-1" role="dialog" data-bs-backdrop="static" data-bs-keyboard="false">
        <div class="modal-dialog modal-dialog-centered" role="document">
            <div class="modal-content">
                <div class="modal-header bg-danger text-white">
                    <h5 class="modal-title w-100 text-center text-white" style="color: white !important;">Sesión Expirada</h5>
                </div>
                <div class="modal-body text-center pt-4">
                    <h4 class="mb-3">Tu sesión ha caducado</h4>
                    <p class="mb-4">Por favor, inicia sesión nuevamente para continuar operando de manera segura.</p>
                    <a href="/login" class="default-btn w-100 d-block text-center">
                        Iniciar Sesión
                    </a>
                </div>
            </div>
        </div>
    </div>`;

	// Inyectar el modal en el body si no existe
	if (!document.getElementById('sessionExpiredModal')) {
		document.body.insertAdjacentHTML('beforeend', sessionExpiredModalHTML);
	}

	// Guardar la referencia original de fetch
	const originalFetch = window.fetch;

	// Sobreescribir fetch
	window.fetch = async function (...args) {
		try {
			const response = await originalFetch(...args);

			// Si la respuesta es 401 (Unauthorized)
			if (response.status === 401) {
				// Verificar si es la página de login para evitar loops
				// En web la ruta de login es /login (limpia) o /login.html
				if (!window.location.pathname.includes('/login')) {
					// Limpiar localStorage
					localStorage.removeItem('accessToken');
					localStorage.removeItem('refreshToken');

					// Mostrar Modal usando Bootstrap 5
					const modalEl = document.getElementById('sessionExpiredModal');
					// Verificar si bootstrap está disponible globalmente
					if (window.bootstrap && window.bootstrap.Modal) {
						const modal = new bootstrap.Modal(modalEl);
						modal.show();
					} else {
						// Fallback
						alert("Tu sesión ha caducado. Por favor, inicia sesión nuevamente.");
						window.location.href = '/login';
					}
				}
			}

			return response;
		} catch (error) {
			throw error;
		}
	};
})();
